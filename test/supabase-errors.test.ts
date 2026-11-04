import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { SupabaseRepository } from '../src/repositories/supabase.js';
import { supabaseFailureMessage } from '../src/repositories/supabase-errors.js';
import { defaultRules } from '../src/domain/models.js';

test('diagnóstico distingue autenticação, permissões, migração, endpoint e rede', () => {
  assert.match(supabaseFailureMessage({}, 401), /Autenticação recusada/);
  assert.match(supabaseFailureMessage({ code: '42501' }, 403), /Acesso ao banco negado/);
  assert.match(supabaseFailureMessage({ code: 'PGRST205' }, 404), /Tabela da aplicação ausente/);
  assert.match(supabaseFailureMessage({ code: 'PGRST202' }, 404), /Função SQL/);
  assert.match(supabaseFailureMessage({}, 404), /Endpoint do projeto/);
  assert.match(supabaseFailureMessage({ code: 'PGRST106' }, 406), /Esquema public/);
  assert.match(
    supabaseFailureMessage({ code: '', message: 'TypeError: fetch failed' }, 0),
    /Não foi possível conectar/,
  );
  assert.match(supabaseFailureMessage({}, 503), /temporariamente indisponível/);
});
test('diagnóstico nunca revela mensagens, detalhes, hints ou códigos arbitrários externos', () => {
  const secret = 'sb_secret_DO_NOT_EXPOSE_THIS';
  for (const status of [undefined, 0, 400, 401, 403, 404, 503]) {
    const result = supabaseFailureMessage(
      {
        code: secret,
        message: `Invalid API key ${secret}`,
        details: `Authorization: Bearer ${secret}`,
        hint: secret,
      },
      status,
    );
    assert.doesNotMatch(result, /DO_NOT_EXPOSE|Authorization|Bearer/);
  }
});
test('consulta de inicialização preserva HTTP 401 sem imprimir corpo externo', async () => {
  const key = 'sb_secret_TEST_ONLY_NOT_A_REAL_KEY';
  const client = createClient('https://mock.supabase.co', key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async () =>
        new Response(JSON.stringify({ message: `Invalid API key ${key}` }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
    },
  });
  const repository = new SupabaseRepository('https://mock.supabase.co', key, client);
  await assert.rejects(
    () => repository.getRules(),
    (error) => {
      assert.match((error as Error).message, /HTTP 401/);
      assert.match((error as Error).message, /mesmo projeto/);
      assert.doesNotMatch((error as Error).message, /TEST_ONLY_NOT_A_REAL_KEY/);
      return true;
    },
  );
});
test('Secret key nova é usada na consulta de settings e tabela vazia carrega regras padrão', async () => {
  const key = 'sb_secret_TEST_ONLY_NOT_A_REAL_KEY';
  let calls = 0;
  const client = createClient('https://mock.supabase.co', key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (request, init) => {
        const url = new URL(String(request));
        assert.equal(url.pathname, '/rest/v1/settings');
        assert.equal(new Headers(init?.headers).get('apikey'), key);
        calls++;
        return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
      },
    },
  });
  const repository = new SupabaseRepository('https://mock.supabase.co', key, client);
  assert.deepEqual(await repository.getRules(), defaultRules);
  assert.equal(calls, 1);
});
