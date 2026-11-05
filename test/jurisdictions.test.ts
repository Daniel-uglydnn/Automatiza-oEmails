import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { operationsSchema } from '../src/domain/operations.js';
import { fixture } from './helpers.js';

const token = 'test-admin-token-for-jurisdiction-review-only';
const review = {
  country: 'US',
  legalBasis: 'Test-only review for mocked business contacts; no real permission is granted.',
  evidenceUrl: 'https://www.ftc.gov/business-guidance',
  confirmed: true,
};

test('revisão de país exige autenticação, confirmação explícita e evidência válida', async (t) => {
  const { repository, service } = await fixture(t);
  const app = await buildApp(loadConfig({ API_AUTH_TOKEN: token }), service, resolve('src/web'));
  t.after(() => app.close());
  const url = '/api/operations/jurisdictions';
  assert.equal((await app.inject({ method: 'POST', url, payload: review })).statusCode, 401);
  for (const payload of [
    { ...review, confirmed: false },
    { ...review, confirmed: undefined },
    { ...review, country: 'BR' },
    { ...review, country: 'invalid' },
    { ...review, legalBasis: '' },
    { ...review, evidenceUrl: 'http://example.com' },
    { ...review, reviewedAt: '2026-11-05T12:00:00Z' },
    { ...review, authorizedAt: '2026-11-05T12:00:00Z' },
  ]) {
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: { authorization: `Bearer ${token}` },
          payload,
        })
      ).statusCode,
      400,
    );
  }
  assert.equal(await repository.getRecord('operations', 'default'), null);
});

test('revisão usa data do servidor, preserva identidade, atualiza país sem duplicar e revoga ativação', async (t) => {
  const { repository, service } = await fixture(t);
  const previous = operationsSchema.parse({
    paused: true,
    useAI: false,
    business: {
      name: 'Test Business',
      email: 'daniel@test.example',
      postalAddress: 'TEST address 123, Example city, US',
    },
    jurisdictions: [
      {
        country: 'GB',
        legalBasis: 'Existing test-only review for mocked contacts.',
        evidenceUrl: 'https://ico.org.uk/',
        reviewedAt: '2026-11-04T12:00:00Z',
      },
    ],
    retentionDays: 120,
    authorizedAt: '2026-11-04T12:00:00Z',
    unsubscribeVerifiedAt: '2026-11-04T12:00:00Z',
  });
  await repository.putRecord('operations', 'default', previous);
  const config = loadConfig({ API_AUTH_TOKEN: token });
  const app = await buildApp(config, service, resolve('src/web'));
  t.after(() => app.close());
  const headers = { authorization: `Bearer ${token}` };
  const started = Date.now();
  const response = await app.inject({
    method: 'POST',
    url: '/api/operations/jurisdictions',
    headers,
    payload: review,
  });
  assert.equal(response.statusCode, 200, response.body);
  let settings = operationsSchema.parse(await repository.getRecord('operations', 'default'));
  assert.equal(settings.jurisdictions.length, 2);
  const registered = settings.jurisdictions.find((rule) => rule.country === 'US')!;
  assert.ok(Date.parse(registered.reviewedAt) >= started);
  assert.ok(Date.parse(registered.reviewedAt) <= Date.now());
  assert.equal(registered.legalBasis, review.legalBasis);
  assert.equal(registered.evidenceUrl, review.evidenceUrl);
  assert.deepEqual(settings.jurisdictions[0], previous.jurisdictions[0]);
  assert.deepEqual(settings.business, previous.business);
  assert.equal(settings.retentionDays, 120);
  assert.equal(settings.useAI, false);
  assert.equal(settings.paused, true);
  assert.equal(settings.authorizedAt, null);
  assert.equal(settings.unsubscribeVerifiedAt, null);
  const updated = await app.inject({
    method: 'POST',
    url: '/api/operations/jurisdictions',
    headers,
    payload: { ...review, legalBasis: `${review.legalBasis} Updated test-only review.` },
  });
  assert.equal(updated.statusCode, 200, updated.body);
  settings = operationsSchema.parse(await repository.getRecord('operations', 'default'));
  assert.equal(settings.jurisdictions.filter((rule) => rule.country === 'US').length, 1);
  assert.match(settings.jurisdictions.find((rule) => rule.country === 'US')!.legalBasis, /Updated/);
  assert.equal(config.DELIVERY_MODE, 'dry-run');
  assert.equal(config.ENABLE_LIVE_SENDS, 'false');
  assert.deepEqual(await repository.deliveries(), []);
});

test('remover país exige autenticação e preserva outros países enquanto revoga ativação', async (t) => {
  const { repository, service } = await fixture(t);
  const previous = operationsSchema.parse({
    jurisdictions: ['US', 'CA'].map((country) => ({
      country,
      legalBasis: review.legalBasis,
      evidenceUrl: review.evidenceUrl,
      reviewedAt: '2026-11-04T12:00:00Z',
    })),
    authorizedAt: '2026-11-04T12:00:00Z',
    unsubscribeVerifiedAt: '2026-11-04T12:00:00Z',
  });
  await repository.putRecord('operations', 'default', previous);
  const app = await buildApp(loadConfig({ API_AUTH_TOKEN: token }), service, resolve('src/web'));
  t.after(() => app.close());
  const url = '/api/operations/jurisdictions/US';
  assert.equal((await app.inject({ method: 'DELETE', url })).statusCode, 401);
  const response = await app.inject({
    method: 'DELETE',
    url,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(response.statusCode, 200, response.body);
  const settings = operationsSchema.parse(await repository.getRecord('operations', 'default'));
  assert.deepEqual(settings.jurisdictions, [previous.jurisdictions[1]]);
  assert.equal(settings.authorizedAt, null);
  assert.equal(settings.unsubscribeVerifiedAt, null);
  assert.deepEqual(await repository.deliveries(), []);
});
