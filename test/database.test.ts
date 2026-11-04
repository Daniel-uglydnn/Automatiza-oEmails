import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createClient } from '@supabase/supabase-js';
import { SupabaseRepository } from '../src/repositories/supabase.js';
import { defaultRules } from '../src/domain/models.js';

test('migração PostgreSQL aplica, repete, isola RLS e serializa por lease', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    const sql = await readFile('supabase/migrations/202611040001_initial.sql', 'utf8');
    await db.exec(sql); await db.exec(sql);
    const first = randomUUID(), second = randomUUID();
    const acquire = async (owner: string) => (await db.query<{ acquired: boolean }>('select acquire_prospecting_lock($1) as acquired', [owner])).rows[0]!.acquired;
    assert.equal(await acquire(first), true); assert.equal(await acquire(second), false);
    await db.query('select release_prospecting_lock($1)', [second]); assert.equal(await acquire(second), false);
    await db.query('select release_prospecting_lock($1)', [first]); assert.equal(await acquire(second), true);
    await db.exec("update prospecting_lock set expires_at = now() - interval '1 second';");
    assert.equal(await acquire(first), true);
    await db.exec('set role anon;');
    await assert.rejects(() => db.query('select * from campaigns'), /permission denied/);
    await assert.rejects(() => db.query('select acquire_prospecting_lock($1)', [randomUUID()]), /permission denied/);
    await db.exec('reset role; set role service_role;');
    await db.query("insert into settings (id, document) values ('default', $1)", [JSON.stringify(defaultRules)]);
    assert.equal((await db.query('select * from settings')).rows.length, 1);
  } finally { await db.close(); }
});
test('Supabase pagina histórico e bloqueios além do limite padrão do PostgREST', async () => {
  const offsets: string[] = [];
  const fetcher: typeof fetch = async (request, init) => {
    const url = new URL(String(request)); const offset = Number(url.searchParams.get('offset') ?? 0); offsets.push(`${url.pathname}:${offset}`);
    if (url.pathname.endsWith('/campaigns')) {
      const rows = Array.from({ length: offset === 0 ? 500 : 1 }, () => ({ document: { id: randomUUID(), createdAt: '2026-11-04T12:00:00Z', mode: 'demo', input: { maxResults: 1 }, rules: defaultRules, warnings: [], leads: [] } }));
      return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname.endsWith('/suppressions')) return new Response(JSON.stringify(offset === 0 ? Array.from({ length: 500 }, (_, i) => ({ email: `contact${i}@example.com`, created_at: '2026-11-04T12:00:00Z', reason: 'manual' })) : [{ email: 'last@example.com', created_at: '2026-11-04T12:00:00Z', reason: 'unsubscribe' }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    throw new Error(`Unexpected request: ${init?.method}`);
  };
  const client = createClient('https://mock.supabase.co', 'test-key', { global: { fetch: fetcher } });
  const repository = new SupabaseRepository('https://mock.supabase.co', 'test-key', client);
  assert.equal((await repository.list()).length, 501);
  assert.equal((await repository.suppressions()).length, 501);
  assert.ok(offsets.some(offset => offset.endsWith(':500')));
});
