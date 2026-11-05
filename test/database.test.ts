import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createClient } from '@supabase/supabase-js';
import { SupabaseRepository } from '../src/repositories/supabase.js';
import { defaultRules } from '../src/domain/models.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { DemoDiscovery } from '../src/providers/demo.js';
import { ProspectingService } from '../src/services/prospecting.js';
import { resolve } from 'node:path';

test('migração PostgreSQL aplica, repete, isola RLS e serializa por lease', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      'create role anon; create role authenticated; create role service_role bypassrls;',
    );
    const sql = await readFile('supabase/migrations/202611040001_initial.sql', 'utf8');
    await db.exec(sql);
    await db.exec(sql);
    const automationSQL = await readFile('supabase/migrations/202611040002_automation.sql', 'utf8');
    await db.exec(automationSQL);
    await db.exec(automationSQL);
    const deliveryId = randomUUID(),
      emailKey = 'a'.repeat(64);
    const insert = (id: string, channel: string, email: string) =>
      db.query(
        'insert into deliveries (id, channel_id, email_key, document) values ($1,$2,$3,$4)',
        [id, channel, email, JSON.stringify({ id, channelId: channel, emailKey: email })],
      );
    await insert(deliveryId, 'UC-test-1', emailKey);
    await assert.rejects(
      () => insert(randomUUID(), 'UC-test-1', 'b'.repeat(64)),
      /unique constraint/,
    );
    await assert.rejects(() => insert(randomUUID(), 'UC-test-2', emailKey), /unique constraint/);
    const first = randomUUID(),
      second = randomUUID();
    const acquire = async (owner: string) =>
      (
        await db.query<{ acquired: boolean }>('select acquire_prospecting_lock($1) as acquired', [
          owner,
        ])
      ).rows[0]!.acquired;
    assert.equal(await acquire(first), true);
    assert.equal(await acquire(second), false);
    await db.query('select release_prospecting_lock($1)', [second]);
    assert.equal(await acquire(second), false);
    await db.query('select release_prospecting_lock($1)', [first]);
    assert.equal(await acquire(second), true);
    await db.exec("update prospecting_lock set expires_at = now() - interval '1 second';");
    assert.equal(await acquire(first), true);
    await db.exec('set role anon;');
    await assert.rejects(() => db.query('select * from deliveries'), /permission denied/);
    await assert.rejects(() => db.query('select * from app_records'), /permission denied/);
    await assert.rejects(
      () => db.query('select acquire_automation_lock($1)', [randomUUID()]),
      /permission denied/,
    );
    await assert.rejects(() => db.query('select * from campaigns'), /permission denied/);
    await assert.rejects(
      () => db.query('select acquire_prospecting_lock($1)', [randomUUID()]),
      /permission denied/,
    );
    await db.exec('reset role; set role service_role;');
    await db.query("insert into settings (id, document) values ('default', $1)", [
      JSON.stringify(defaultRules),
    ]);
    assert.equal((await db.query('select * from settings')).rows.length, 1);
  } finally {
    await db.close();
  }
});
test('Supabase pagina histórico e bloqueios além do limite padrão do PostgREST', async () => {
  const offsets: string[] = [];
  const fetcher: typeof fetch = async (request, init) => {
    const url = new URL(String(request));
    const offset = Number(url.searchParams.get('offset') ?? 0);
    offsets.push(`${url.pathname}:${offset}`);
    if (url.pathname.endsWith('/campaigns')) {
      const rows = Array.from({ length: offset === 0 ? 500 : 1 }, () => ({
        document: {
          id: randomUUID(),
          createdAt: '2026-11-04T12:00:00Z',
          mode: 'demo',
          input: { maxResults: 1 },
          rules: defaultRules,
          warnings: [],
          leads: [],
        },
      }));
      return new Response(JSON.stringify(rows), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.pathname.endsWith('/suppressions'))
      return new Response(
        JSON.stringify(
          offset === 0
            ? Array.from({ length: 500 }, (_, i) => ({
                email: `contact${i}@example.com`,
                created_at: '2026-11-04T12:00:00.123456+00:00',
                reason: 'manual',
              }))
            : [
                {
                  email: 'last@example.com',
                  created_at: '2026-11-04T09:00:00.123-03:00',
                  reason: 'unsubscribe',
                },
              ],
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    throw new Error(`Unexpected request: ${init?.method}`);
  };
  const client = createClient('https://mock.supabase.co', 'test-key', {
    global: { fetch: fetcher },
  });
  const repository = new SupabaseRepository('https://mock.supabase.co', 'test-key', client);
  assert.equal((await repository.list()).length, 501);
  const suppressions = await repository.suppressions();
  assert.equal(suppressions.length, 501);
  assert.equal(suppressions[0]!.createdAt, '2026-11-04T12:00:00.123Z');
  assert.deepEqual(suppressions.at(-1), {
    email: 'last@example.com',
    createdAt: '2026-11-04T12:00:00.123Z',
    reason: 'unsubscribe',
  });
  assert.ok(offsets.some((offset) => offset.endsWith(':500')));
});

test('dashboard autenticado carrega bloqueios Supabase com timestamps PostgreSQL', async (t) => {
  const rows = [
    {
      email: 'declined@example.com',
      created_at: '2026-11-05T12:00:00.123456+00:00',
      reason: 'negative',
    },
    {
      email: 'unsubscribe-self-test-regression@example.invalid',
      created_at: '2026-11-05T09:00:00-03:00',
      reason: 'unsubscribe',
    },
    {
      email: 'blocked@example.com',
      created_at: '2026-11-05T17:30:00.456+05:30',
      reason: 'manual',
    },
    {
      email: 'utc@example.com',
      created_at: '2026-11-05T12:00:00Z',
      reason: 'manual',
    },
  ];
  const client = createClient('https://mock.supabase.co', 'test-key', {
    global: {
      fetch: async (input, init) => {
        assert.equal(init?.method ?? 'GET', 'GET', 'Carregar o painel não deve alterar o banco.');
        const table = new URL(String(input)).pathname.split('/').at(-1);
        assert.ok(
          [
            'suppressions',
            'campaigns',
            'settings',
            'error_events',
            'deliveries',
            'app_records',
          ].includes(table!),
        );
        return new Response(JSON.stringify(table === 'suppressions' ? rows : []), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
  });
  const repository = new SupabaseRepository('https://mock.supabase.co', 'test-key', client);
  const service = new ProspectingService(repository, new DemoDiscovery(), 'demo', null);
  const admin = 'test-admin-token-with-more-than-32-characters';
  const signingKey = 'test-unsubscribe-key-with-more-than-32-characters';
  const app = await buildApp(
    loadConfig({ API_AUTH_TOKEN: admin, UNSUBSCRIBE_SIGNING_KEY: signingKey }),
    service,
    resolve('src/web'),
  );
  t.after(() => app.close());
  for (const token of ['', signingKey]) {
    assert.equal(
      (await app.inject({ url: '/api/dashboard', headers: { authorization: `Bearer ${token}` } }))
        .statusCode,
      401,
    );
  }
  const headers = { authorization: `Bearer ${admin}` };
  const dashboard = await app.inject({ url: '/api/dashboard', headers });
  assert.equal(dashboard.statusCode, 200, dashboard.body);
  assert.deepEqual(
    dashboard.json().suppressions,
    rows.map((row) => ({
      email: row.email,
      reason: row.reason,
      createdAt: new Date(row.created_at).toISOString(),
    })),
  );
  assert.equal(dashboard.json().stats.sent, 0);
  assert.equal(dashboard.json().deliveryMode, 'dry-run');
  assert.equal(dashboard.json().sendingEnabled, false);
  const operations = await app.inject({ url: '/api/operations', headers });
  assert.equal(operations.statusCode, 200, operations.body);
  assert.equal(operations.json().settings.authorizedAt, null);
});

test('Supabase continua rejeitando datas de bloqueio inválidas ou sem fuso', async () => {
  for (const createdAt of [
    'invalid',
    '2026-02-30T12:00:00+00:00',
    '2026-11-05T25:00:00+00:00',
    '2026-11-05T12:00:00+99:99',
    '2026-11-05T12:00:00',
    null,
  ]) {
    const client = createClient('https://mock.supabase.co', 'test-key', {
      global: {
        fetch: async () =>
          new Response(
            JSON.stringify([
              { email: 'blocked@example.com', reason: 'manual', created_at: createdAt },
            ]),
            { headers: { 'Content-Type': 'application/json' } },
          ),
      },
    });
    const repository = new SupabaseRepository('https://mock.supabase.co', 'test-key', client);
    await assert.rejects(() => repository.suppressions(), { name: 'ZodError' });
  }
});
