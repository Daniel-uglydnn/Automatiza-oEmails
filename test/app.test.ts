import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { unsubscribeToken, verifyUnsubscribeToken } from '../src/domain/unsubscribe.js';
import { fixture } from './helpers.js';

test('API e painel servem o fluxo de simulação, com validação de entrada', async (t) => {
  const { service, directory } = await fixture(t);
  const app = await buildApp(loadConfig({ DATA_DIR: directory }), service, resolve('src/web'));
  t.after(() => app.close());
  assert.equal((await app.inject('/')).statusCode, 200);
  assert.equal((await app.inject('/styles.css')).statusCode, 200);
  assert.equal((await app.inject('/health')).json().deliveryMode, 'dry-run');
  const created = await app.inject({
    method: 'POST',
    url: '/api/campaigns',
    payload: { maxResults: 8 },
  });
  assert.equal(created.statusCode, 201);
  const campaign = created.json();
  const simulated = await app.inject({
    method: 'POST',
    url: `/api/campaigns/${campaign.id}/simulate`,
  });
  assert.equal(simulated.statusCode, 200);
  assert.equal(simulated.json().simulated, 4);
  const stats = (await app.inject('/api/dashboard')).json().stats;
  assert.equal(stats.sent, 0);
  assert.equal(stats.simulated, 4);
  assert.equal(
    (await app.inject({ method: 'POST', url: '/api/campaigns', payload: { maxResults: 101 } }))
      .statusCode,
    400,
  );
  assert.equal((await app.inject('/api/campaigns/../../etc/passwd')).statusCode, 404);
  const integrations = (await app.inject('/api/integrations')).json();
  assert.equal(integrations.gmail.sendingEnabled, false);
  assert.equal(integrations.gmail.configured, false);
});
test('token protege as APIs; origem externa e DNS rebinding são rejeitados', async (t) => {
  const { service } = await fixture(t);
  const token = 'a'.repeat(40);
  const app = await buildApp(loadConfig({ API_AUTH_TOKEN: token }), service, resolve('src/web'));
  t.after(() => app.close());
  assert.equal((await app.inject('/api/dashboard')).statusCode, 401);
  assert.equal(
    (await app.inject({ url: '/api/dashboard', headers: { authorization: `Bearer ${token}` } }))
      .statusCode,
    200,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/campaigns',
        payload: {},
        headers: { authorization: `Bearer ${token}`, origin: 'https://evil.example' },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        url: '/api/dashboard',
        headers: { host: 'evil.example', authorization: `Bearer ${token}` },
      })
    ).statusCode,
    403,
  );
  for (const url of [
    '/api%2fdashboard',
    '/api/dashboard%2f',
    '/api//dashboard',
    '//api/dashboard',
  ]) {
    const response = await app.inject(url);
    assert.notEqual(response.statusCode, 200, url);
  }
});
test('segredos não aparecem em respostas e modo live exige credenciais', async (t) => {
  assert.throws(() => loadConfig({ APP_MODE: 'live' }), /YOUTUBE_API_KEY/);
  assert.throws(() => loadConfig({ HOST: '0.0.0.0' }), /API_AUTH_TOKEN/);
  assert.throws(() => loadConfig({ STORAGE_DRIVER: 'supabase' }), /SUPABASE_URL/);
  const { service } = await fixture(t);
  const config = loadConfig({
    YOUTUBE_API_KEY: 'do-not-leak-youtube',
    LLM_API_KEY: 'do-not-leak-openai',
  });
  const app = await buildApp(config, service, resolve('src/web'));
  t.after(() => app.close());
  const response = await app.inject('/api/integrations');
  assert.doesNotMatch(response.body, /do-not-leak/);
  assert.equal(response.json().youtube.configured, true);
});
test('descadastro assinado é público, idempotente e GET não altera estado', async (t) => {
  const { service, repository } = await fixture(t);
  const key = 'signing-key-for-tests-only-32-characters';
  const token = unsubscribeToken('Business@Example.com', key);
  assert.equal(verifyUnsubscribeToken(token, key), 'business@example.com');
  assert.throws(() => verifyUnsubscribeToken(`${token}x`, key));
  const app = await buildApp(
    loadConfig({ API_AUTH_TOKEN: 'private-token', UNSUBSCRIBE_SIGNING_KEY: key }),
    service,
    resolve('src/web'),
  );
  t.after(() => app.close());
  assert.equal((await app.inject(`/unsubscribe?token=${token}`)).statusCode, 200);
  assert.equal((await repository.suppressions()).length, 0);
  for (let i = 0; i < 2; i++) {
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: `/unsubscribe?token=${token}`,
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          payload: 'List-Unsubscribe=One-Click',
        })
      ).statusCode,
      200,
    );
  }
  assert.equal((await repository.suppressions()).length, 1);
  assert.equal((await repository.suppressions())[0]?.reason, 'unsubscribe');
  assert.equal(
    (await app.inject({ method: 'POST', url: '/unsubscribe?token=forged' })).statusCode,
    400,
  );
});
test('rotas inexistentes não oferecem nenhum endpoint de envio', async (t) => {
  const { service } = await fixture(t);
  const app = await buildApp(loadConfig({}), service, resolve('src/web'));
  t.after(() => app.close());
  assert.equal(
    (await app.inject({ method: 'POST', url: '/api/send', payload: {} })).statusCode,
    404,
  );
  assert.equal((await app.inject('/.env')).statusCode, 404);
  assert.equal((await app.inject('/../package.json')).statusCode, 404);
});
test('primeiro deploy Render usa origem automática com autenticação e envio desligado', async (t) => {
  const { service } = await fixture(t);
  const token = 'test-admin-token-with-more-than-32-characters';
  const config = loadConfig({
    HOST: '0.0.0.0',
    API_AUTH_TOKEN: token,
    RENDER_EXTERNAL_URL: 'https://test-service.onrender.com/',
  });
  assert.equal(config.PUBLIC_ORIGIN, 'https://test-service.onrender.com');
  assert.equal(config.DELIVERY_MODE, 'dry-run');
  assert.equal(config.ENABLE_LIVE_SENDS, 'false');
  const app = await buildApp(config, service, resolve('src/web'));
  t.after(() => app.close());
  const headers = { host: 'test-service.onrender.com' };
  assert.equal((await app.inject({ url: '/health', headers })).statusCode, 200);
  assert.equal((await app.inject({ url: '/api/dashboard', headers })).statusCode, 401);
  assert.equal(
    (
      await app.inject({
        url: '/api/dashboard',
        headers: { ...headers, authorization: `Bearer ${token}`, origin: config.PUBLIC_ORIGIN },
      })
    ).statusCode,
    200,
  );
});
test('domínio explícito prevalece sobre Render e origem automática insegura é rejeitada', () => {
  assert.equal(
    loadConfig({
      PUBLIC_ORIGIN: 'https://custom.example',
      RENDER_EXTERNAL_URL: 'https://default.onrender.com',
    }).PUBLIC_ORIGIN,
    'https://custom.example',
  );
  assert.throws(
    () => loadConfig({ RENDER_EXTERNAL_URL: 'http://unsafe.example' }),
    /PUBLIC_ORIGIN/,
  );
});
