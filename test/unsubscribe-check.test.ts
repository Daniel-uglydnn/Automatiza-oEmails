import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { fixture } from './helpers.js';
import { operationsSchema } from '../src/domain/operations.js';
import { OperationsService } from '../src/services/operations.js';
import { GmailConnection } from '../src/services/oauth.js';
import { verifyUnsubscribeToken } from '../src/domain/unsubscribe.js';

const key = 'test-signing-key-with-more-than-32-characters';
const admin = 'test-administrative-token-with-more-than-32-characters';
const origin = 'https://dashboard.example';

test('teste de descadastro percorre GET/POST públicos, verifica banco e não autoriza envios', async (t) => {
  const { service, repository } = await fixture(t);
  await repository.putRecord(
    'operations',
    'default',
    operationsSchema.parse({ useAI: false, paused: true, retentionDays: 120 }),
  );
  const config = loadConfig({
    PUBLIC_ORIGIN: origin,
    API_AUTH_TOKEN: admin,
    UNSUBSCRIBE_SIGNING_KEY: key,
  });
  let app: Awaited<ReturnType<typeof buildApp>>;
  const methods: string[] = [];
  const probe: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, origin);
    assert.equal(init?.redirect, 'error');
    assert.ok(init?.signal);
    const headers = new Headers(init?.headers);
    assert.equal(headers.has('authorization'), false);
    assert.equal(headers.has('apikey'), false);
    const recipient = verifyUnsubscribeToken(url.searchParams.get('token')!, key);
    assert.match(recipient, /^unsubscribe-self-test-[0-9a-f-]+@example\.invalid$/);
    assert.equal(
      (await repository.suppressions()).some((s) => s.email === recipient),
      false,
    );
    const method = init?.method === 'POST' ? 'POST' : 'GET';
    methods.push(method);
    headers.set('host', new URL(origin).host);
    if (method === 'POST') assert.equal(init?.body, 'List-Unsubscribe=One-Click');
    const response = await app.inject({
      method,
      url: url.pathname + url.search,
      headers: Object.fromEntries(headers),
      ...(method === 'POST' ? { payload: String(init?.body) } : {}),
    });
    if (method === 'GET') assert.match(response.body, /endereço fictício/);
    return new Response(response.body, {
      status: response.statusCode,
      headers: {
        'Content-Type': String(response.headers['content-type'] ?? ''),
        'X-Unsubscribe-Handler': String(response.headers['x-unsubscribe-handler'] ?? ''),
      },
    });
  };
  app = await buildApp(config, service, resolve('src/web'), { publicFetch: probe });
  t.after(() => app.close());
  const path = '/api/operations/unsubscribe-test';
  assert.equal(
    (await app.inject({ method: 'POST', url: path, headers: { host: new URL(origin).host } }))
      .statusCode,
    401,
  );
  assert.deepEqual(methods, []);
  const response = await app.inject({
    method: 'POST',
    url: path,
    headers: { host: new URL(origin).host, authorization: `Bearer ${admin}` },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().verified, true);
  assert.deepEqual(methods, ['GET', 'POST']);
  assert.equal((await repository.suppressions()).length, 1);
  const settings = operationsSchema.parse(await repository.getRecord('operations', 'default'));
  assert.equal(settings.unsubscribeVerifiedAt, response.json().verifiedAt);
  assert.equal(settings.business, null);
  assert.equal(settings.useAI, false);
  assert.equal(settings.paused, true);
  assert.equal(settings.retentionDays, 120);
  assert.equal(settings.authorizedAt, null);
  assert.deepEqual(settings.jurisdictions, []);
  assert.equal((await service.dashboard()).stats.sent, 0);
  assert.equal((await repository.deliveries()).length, 0);
  assert.equal(await repository.getRecord('credentials', 'gmail'), null);
  assert.doesNotMatch(response.body, new RegExp(key));
});

test('teste sem chave ou origem explica o que falta antes de fazer chamadas externas', async (t) => {
  const { repository } = await fixture(t);
  for (const config of [
    loadConfig({}),
    loadConfig({ PUBLIC_ORIGIN: origin }),
    loadConfig({ UNSUBSCRIBE_SIGNING_KEY: key }),
  ]) {
    const service = new OperationsService(
      config,
      repository,
      new GmailConnection(config, repository),
      async () => {
        throw new Error('must not call network');
      },
    );
    await assert.rejects(() => service.testUnsubscribe(), /UNSUBSCRIBE_SIGNING_KEY/);
  }
});

test('resposta pública positiva sem bloqueio persistido reprova o teste e invalida validação antiga', async (t) => {
  const { repository } = await fixture(t);
  const config = loadConfig({ PUBLIC_ORIGIN: origin, UNSUBSCRIBE_SIGNING_KEY: key });
  await repository.putRecord(
    'operations',
    'default',
    operationsSchema.parse({ unsubscribeVerifiedAt: '2026-01-01T00:00:00Z' }),
  );
  const calls: string[] = [];
  const service = new OperationsService(
    config,
    repository,
    new GmailConnection(config, repository),
    async (_url, init) => {
      calls.push(init!.method!);
      return new Response('ok', { headers: { 'X-Unsubscribe-Handler': 'creator-outreach-v1' } });
    },
  );
  await assert.rejects(() => service.testUnsubscribe(), /bloqueio não foi encontrado/);
  assert.deepEqual(calls, ['GET', 'POST']);
  assert.equal(
    operationsSchema.parse(await repository.getRecord('operations', 'default'))
      .unsubscribeVerifiedAt,
    null,
  );
});

test('página errada, POST recusado e falha de rede não marcam validação nem revelam erros externos', async (t) => {
  const { repository } = await fixture(t);
  const config = loadConfig({ PUBLIC_ORIGIN: origin, UNSUBSCRIBE_SIGNING_KEY: key });
  const probes: Array<typeof fetch> = [
    async () => new Response('wrong page'),
    async (_url, init) =>
      new Response('redacted', {
        status: init?.method === 'POST' ? 403 : 200,
        headers: { 'X-Unsubscribe-Handler': 'creator-outreach-v1' },
      }),
    async () => {
      throw new Error('DO_NOT_LEAK_SECRET_OR_TOKEN');
    },
  ];
  for (const probe of probes) {
    const service = new OperationsService(
      config,
      repository,
      new GmailConnection(config, repository),
      probe,
    );
    await assert.rejects(
      () => service.testUnsubscribe(),
      (error) => {
        assert.doesNotMatch((error as Error).message, /DO_NOT_LEAK/);
        return true;
      },
    );
    assert.equal(
      operationsSchema.parse(await repository.getRecord('operations', 'default'))
        .unsubscribeVerifiedAt,
      null,
    );
  }
  assert.equal((await repository.suppressions()).length, 0);
});
