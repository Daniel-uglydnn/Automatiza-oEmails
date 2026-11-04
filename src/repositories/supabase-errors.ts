// Mensagens externas podem conter URLs, tokens, SQL e dados pessoais.
// Somente classificamos sinais conhecidos; nunca mostramos o corpo original.
export function supabaseFailureMessage(error: unknown, status?: number): string {
  const value = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  const code = typeof value.code === 'string' ? value.code : '';
  const message =
    typeof value.message === 'string' ? value.message.slice(0, 4000).toLowerCase() : '';
  const http =
    Number.isInteger(status) && status! >= 100 && status! <= 599 ? ` (HTTP ${status})` : '';
  let reason: string;
  if (code === '42501' || status === 403) {
    reason =
      'Acesso ao banco negado. Use a Secret key de backend (sb_secret_) ou service_role, não a Publishable/anon; confirme os grants das migrações. Não desative RLS.';
  } else if (['PGRST205', '42P01'].includes(code)) {
    reason =
      'Tabela da aplicação ausente na Data API. Execute as duas migrações no mesmo projeto de SUPABASE_URL e confirme o esquema public exposto na Data API.';
  } else if (['PGRST202', '42883'].includes(code)) {
    reason =
      'Função SQL da aplicação não disponível. Confirme que as duas migrações foram aplicadas no projeto configurado e que o cache da Data API está atualizado.';
  } else if (
    status === 401 ||
    ['PGRST301', 'PGRST302', 'PGRST303'].includes(code) ||
    /invalid api[ _-]?key|invalid jwt|jwt expired|no api[ _-]?key/.test(message)
  ) {
    reason =
      'Autenticação recusada. Confira SUPABASE_SERVICE_ROLE_KEY: copie o valor completo da Secret key (sb_secret_) ou service_role do mesmo projeto de SUPABASE_URL, sem aspas. Não use o nome da chave nem a Publishable key.';
  } else if (code === 'PGRST106') {
    reason =
      'Esquema public não está disponível na Data API. Confira os esquemas expostos nas configurações da Data API do projeto.';
  } else if (status === 404) {
    reason =
      'Endpoint do projeto não encontrado. SUPABASE_URL deve ser a Project URL, sem /dashboard e sem /rest/v1. Confirme que a Data API está habilitada.';
  } else if (
    status === 0 ||
    ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(
      code,
    ) ||
    /fetch failed|network error|failed to fetch|timed? ?out/.test(message)
  ) {
    reason =
      'Não foi possível conectar ao projeto. Confira SUPABASE_URL, DNS/rede e se o projeto Supabase está ativo, sem pausa. Uma falha de rede não confirma que a chave esteja errada.';
  } else if (
    [502, 503, 504].includes(status ?? -1) ||
    ['PGRST000', 'PGRST001', 'PGRST002'].includes(code)
  ) {
    reason =
      'Serviço do banco/Data API temporariamente indisponível. Confira se o projeto está ativo e se a Data API está habilitada.';
  } else {
    reason =
      'Erro ao consultar o banco. Confira a Project URL, a Secret key de backend, a Data API e as duas migrações no mesmo projeto.';
  }
  const known = new Set([
    '42501',
    'PGRST205',
    '42P01',
    'PGRST202',
    '42883',
    'PGRST301',
    'PGRST302',
    'PGRST303',
    'PGRST106',
    'PGRST000',
    'PGRST001',
    'PGRST002',
  ]);
  return `Falha no Supabase${http}${known.has(code) ? ` [${code}]` : ''}: ${reason}`;
}
