import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { fixture } from './helpers.js';
import { GmailConnection } from '../src/services/oauth.js';
import { OperationsService } from '../src/services/operations.js';
import { loadConfig } from '../src/config.js';
import { gmailScopes } from '../src/domain/operations.js';
import { liveFixture } from './live-helpers.js';

test('OAuth usa state, PKCE, escopos mínimos e guarda refresh token criptografado', async (t) => {
  const { repository } = await fixture(t);
  const config = loadConfig({
    GMAIL_CLIENT_ID: 'client-id-test',
    GMAIL_CLIENT_SECRET: 'secret-test',
    CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  });
  const json = (value: unknown) =>
    new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
  const fetcher: typeof fetch = async (request, init) => {
    if (String(request).includes('/token')) {
      const body = new URLSearchParams(init?.body as URLSearchParams);
      if (body.get('grant_type') === 'authorization_code') {
        assert.ok(body.get('code_verifier'));
        assert.equal(body.get('code'), 'test-auth-code');
        return json({ refresh_token: 'super-secret-refresh-test', scope: gmailScopes.join(' ') });
      }
      return json({
        access_token: 'short-lived-access-test',
        scope: gmailScopes.join(' '),
        expires_in: 3600,
      });
    }
    return json({ emailAddress: 'daniel@example.com' });
  };
  const oauth = new GmailConnection(config, repository, fetcher);
  const url = new URL(await oauth.start());
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('scope'), gmailScopes.join(' '));
  const state = url.searchParams.get('state')!;
  const stored = await repository.getRecord(
    'oauth',
    createHash('sha256').update(state).digest('hex'),
  );
  assert.doesNotMatch(JSON.stringify(stored), /verifier|super-secret/);
  await oauth.callback('test-auth-code', state);
  assert.equal((await oauth.status()).email, 'daniel@example.com');
  assert.doesNotMatch(
    JSON.stringify(await repository.getRecord('credentials', 'gmail')),
    /super-secret-refresh-test|short-lived-access-test/,
  );
  assert.doesNotMatch(JSON.stringify(await oauth.status()), /sealed|refreshToken|access_token/);
  await assert.rejects(() => oauth.callback('test-auth-code', state), /já utilizada/);
  await assert.rejects(
    () => oauth.callback('test-auth-code', 'forged-state-123456789'),
    /inválida/,
  );
});
test('dashboard não pode habilitar envio enquanto bloqueio do servidor estiver ativo', async (t) => {
  const { repository } = await fixture(t);
  const config = loadConfig({});
  const connection = new GmailConnection(config, repository, async () => {
    throw new Error('no network');
  });
  const operations = new OperationsService(config, repository, connection);
  await assert.rejects(
    () =>
      operations.authorize({
        authorization: 'AUTHORIZE_AUTOMATIC_OUTREACH',
        identityReviewed: true,
        complianceReviewed: true,
        unsubscribeReviewed: true,
      }),
    /desativado/,
  );
  await assert.rejects(() => operations.update({ authorizedAt: new Date().toISOString() }));
  await assert.rejects(() =>
    operations.update({
      jurisdictions: [
        {
          country: 'BR',
          legalBasis: 'test legal basis',
          reviewedAt: new Date().toISOString(),
          evidenceUrl: 'https://example.com',
        },
      ],
    }),
  );
  assert.equal((await operations.get()).authorizedAt, null);
});
test('alterações de identidade e jurisdição revogam autorização e resumo não vai a terceiros', async (t) => {
  const { repository } = await fixture(t);
  const config = loadConfig({});
  const operations = new OperationsService(
    config,
    repository,
    new GmailConnection(config, repository),
  );
  await repository.putRecord('operations', 'default', {
    authorizedAt: new Date().toISOString(),
    unsubscribeVerifiedAt: new Date().toISOString(),
  });
  await operations.update({
    business: {
      name: 'Daniel',
      email: 'daniel@example.com',
      postalAddress: 'A valid test postal address, 123, City',
    },
  });
  assert.equal((await operations.get()).authorizedAt, null);
  assert.equal((await operations.get()).unsubscribeVerifiedAt, null);
  await assert.rejects(
    () => operations.update({ reportEmail: 'thirdparty@example.com' }),
    /próprio remetente/,
  );
});
test('autorização inicial valida conta e endpoint HTTPS antes de gravar liberação', async (t) => {
  const f = await liveFixture(t);
  await f.repository.putRecord('operations', 'default', {
    ...f.settings,
    authorizedAt: null,
    unsubscribeVerifiedAt: null,
  });
  const fetcher: typeof fetch = async (request) => {
    const url = String(request);
    if (url.includes('/token'))
      return new Response(
        JSON.stringify({ access_token: 'test-access', scope: gmailScopes.join(' ') }),
        { headers: { 'content-type': 'application/json' } },
      );
    if (url.includes('/profile'))
      return new Response(JSON.stringify({ emailAddress: f.account.email }), {
        headers: { 'content-type': 'application/json' },
      });
    assert.match(url, /^https:\/\/outreach.example\/unsubscribe\?token=/);
    return new Response('<h1>Stop commercial contact</h1>', {
      headers: { 'X-Unsubscribe-Handler': 'creator-outreach-v1' },
    });
  };
  const connection = new GmailConnection(f.config, f.repository, fetcher);
  const operations = new OperationsService(f.config, f.repository, connection, fetcher);
  const settings = await operations.authorize({
    authorization: 'AUTHORIZE_AUTOMATIC_OUTREACH',
    identityReviewed: true,
    complianceReviewed: true,
    unsubscribeReviewed: true,
  });
  assert.ok(settings.authorizedAt);
  assert.ok(settings.unsubscribeVerifiedAt);
  assert.equal(f.calls.length, 0);
});
