# Validação da implementação

Execução local em **4 de novembro de 2026**, sem credenciais reais de YouTube/OpenAI/Gmail/Supabase e sem enviar e-mails reais.

| Verificação               | Resultado                                                                                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`           | TypeScript estrito, 68 testes e build aprovados                                                                                                |
| `npm run format:check`    | Aprovado                                                                                                                                       |
| `npm audit`               | Zero vulnerabilidades conhecidas nas dependências instaladas                                                                                   |
| PostgreSQL/PGlite         | Duas migrações repetidas, RLS/permissões, locks e unicidade de canal/e-mail aprovados                                                          |
| Chromium desktop e 390 px | Ciclo completo, 12 indicadores, filtros, CSV, pausa/retomada e bloqueios de ativação aprovados; sem erros de JavaScript ou overflow horizontal |
| Docker build              | Imagem de produção construída com TLS habilitado e CA fornecida por mount temporário, sem credenciais nas camadas                              |
| Container de produção     | Usuário UID 1000, autenticação administrativa, Host configurado e ciclo completo em dry-run aprovados                                          |

O ciclo de demonstração encontrou oito canais fictícios, qualificou quatro e registrou quatro simulações, com **zero envios reais**. A coleta não inventa canais extras. Os testes de transporte com estado `sent` usam exclusivamente doubles de teste, não Gmail real.

Casos críticos cobertos: OAuth state/PKCE e criptografia autenticada; guardas independentes de ativação; jurisdição desconhecida; contato antigo; deduplicação por canal/e-mail; cota global; pausa; exclusão durante lock de campanha; erro de autenticação; timeout e falha de persistência após aceite simulado; reconciliação sem reenvio; respostas e descadastro; resumo próprio dentro da cota; execução diária idempotente; retomada de campanha; backlog; prazo esgotado; robots/SSRF/redirects; CSV e retenção.

Não foram validados: credenciais/cotas de suas contas reais, conectividade de um projeto Supabase remoto, consentimento Google real, endpoint público HTTPS, cron executado no GitHub ou hospedagem publicada. Os arquivos de implantação e agendamento estão preparados; sua ativação depende das configurações descritas nos guias. Os portfólios retornaram bloqueio de rede 403 neste ambiente e não foram examinados.

O ambiente cloud não foi publicado durante o desenvolvimento. Nenhuma configuração atual habilita envio real.
