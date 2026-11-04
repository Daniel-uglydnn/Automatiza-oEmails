# Daniel · Creator Outreach

Aplicação Node.js/TypeScript para descobrir canais de **Minecraft e Roblox**, qualificar oportunidades de edição, preparar propostas em inglês e acompanhar simulações. Inclui dashboard, CLI, YouTube Data API v3, OpenAI, adaptador Gmail, persistência local ou Supabase/PostgreSQL e agendamento diário.

**Esta versão nunca envia e-mails reais.** Não há endpoint nem chamada `messages.send`. Criar uma campanha ou clicar em **Simular** apenas grava o histórico no armazenamento. `APP_MODE=live` significa **descoberta real no YouTube**, não envio real. Os exemplos de demonstração são fictícios e seus contatos usam `.invalid`.

## Executar

Requisitos: Node.js **24.x** e npm. Use o checkout existente; cada tarefa cloud já é isolada, sem necessidade de worktree.

```sh
cd /workspace/Automatiza-oEmails
npm ci
cp .env.example .env  # somente se .env ainda não existir
npm run dev
```

Abra o dashboard na porta **3000**. O servidor escuta em `127.0.0.1` por padrão. Nenhuma credencial é necessária para a demonstração.

```sh
npm run check                 # TypeScript + testes + build backend/frontend
npm start                     # executar o build
npm run prospect -- --max 8 --simulate
```

O modo demo tem **8 canais fixos**, 4 inicialmente qualificados. Uma segunda pesquisa não repete esses canais. Para uma demonstração independente, use outro `DATA_DIR`; não é necessário apagar o histórico. `npm run dev` observa mudanças do backend; depois de editar `src/web`, execute `npm run build:web` e recarregue a página.

## Fluxo

1. Pesquisar Minecraft/Roblox, com distribuição inicial 50/50 e termo adicional opcional.
2. Consultar detalhes e os últimos **10 uploads** de cada canal. Registrar títulos, datas, views e `defaultAudioLanguage` dos vídeos.
3. Qualificar com pontuação explicável e fontes. Canais sem idioma predominante verificável ficam pendentes para revisão humana.
4. Extrair apenas e-mails publicados na descrição em contexto comercial explícito, ou cadastrar manualmente contato com fonte pública e declaração de finalidade comercial. A aplicação não navega em páginas externas, não adivinha e-mails e não contorna CAPTCHA/login.
5. Preparar uma proposta em inglês: Daniel como editor freelancer, referência real a um upload, oferta de edição e os dois portfólios, sem alegação de ter assistido ao vídeo. O dashboard permite editar, gerar com OpenAI e registrar aprovação da revisão.
6. Simular contatos elegíveis respeitando bloqueios, deduplicação e limites. A aprovação de uma proposta não habilita envio.
7. Registrar respostas manualmente. Recusas e descadastros bloqueiam o endereço globalmente. Follow-ups ficam desativados.

Não há “canais inventados” para alcançar a meta: se as buscas retornarem menos canais novos, a campanha registra a quantidade real e um aviso. O histórico deduplica por **ID do canal** e **e-mail normalizado**; não tenta adivinhar se identidades distintas pertencem à mesma pessoa.

## Regras padrão

Os parâmetros ficam em `src/domain/models.ts` e são persistidos pelo dashboard em `.data/rules.json` ou `public.settings`. O servidor valida mudanças; pesos precisam somar 100.

| Regra | Padrão |
| --- | --- |
| Descoberta diária | Até 100 novos canais |
| Divisão | 50% Minecraft / 50% Roblox |
| Idioma | Predominantemente inglês; português excluído |
| País | BR excluído; US, GB, CA, AU, NZ e IE recebem preferência; outros países aceitos |
| Inscritos | Prioridade de 2.000 a 500.000, sem exclusão automática fora da faixa |
| Atividade | Prioridade em 30 dias; máximo de 60 dias |
| Pontuação mínima | 70/100 |
| Limite diário de contatos simulados | 10, configurável até 100 |
| Horário | 09:00 em America/Fortaleza |
| Follow-ups | Desativados |

Idioma não prova país. `regionCode=US` e `relevanceLanguage=en` ajudam a busca, mas **não comprovam** o idioma de um criador. A maioria da amostra precisa declarar áudio em inglês; metadados ausentes/ambíguos exigem revisão com observação e URL. A pontuação é uma triagem de metadata, não substitui avaliação dos vídeos.

| Categoria | Peso | Evidência / fórmula padrão |
| --- | --- | --- |
| Nicho | 20 | Maioria dos títulos da amostra confirma Minecraft/Roblox, ou revisão com fonte |
| Atividade | 20 | 70% pela publicação em até 30 dias + até 30% pela frequência de 4 uploads/30 dias; entre 31–60 dias: 40% |
| Potencial comercial | 20 | 55% por faixa de inscritos (25% fora; 0% ocultos), até 35% por mediana de views/5.000 e 10% por país declarado prioritário |
| Oportunidade de edição | 25 | Avaliação humana 0–1 × peso, exigindo observação concreta e URL; sem avaliação: zero |
| Contato comercial | 15 | E-mail comercial com origem registrada |

Inscritos e views são **heurísticas**, não prova de orçamento ou intenção de compra. O sistema não infere qualidade de edição assistindo a metadata. Não atribui os 25 pontos de edição sem revisão. A elegibilidade também exige nicho, inglês, atividade e contato; uma pontuação alta não anula essas regras.

A pontuação fica registrada na campanha com suas regras originais. A simulação reavalia os canais com as regras atuais e a data atual. O teto diário e a deduplicação são globais entre campanhas, usando a data de Fortaleza. Aumentar o limite exige marcar a revisão de conformidade, qualidade e reputação; isso continua sem habilitar envio real.

## Credenciais e integrações

Use `.env` local ou o gerenciador seguro de segredos do ambiente/hospedagem. Nunca publique chaves. O frontend recebe apenas presença/ausência de configuração. Nenhuma credencial externa estava disponível durante o desenvolvimento; os contratos foram testados com respostas simuladas.

| Integração | Variáveis | Ativação |
| --- | --- | --- |
| YouTube Data API v3 | `YOUTUBE_API_KEY` | Habilitar API no Google Cloud, restringir a chave à API e definir `APP_MODE=live` |
| OpenAI Responses API | `LLM_API_KEY` ou `OPENAI_API_KEY`, `OPENAI_MODEL` | Botão “Gerar com OpenAI”; padrão `gpt-4.1-mini` |
| Gmail OAuth 2.0 | `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` | Adaptador pronto; não é chamado pela simulação ou rotina diária |
| Supabase | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Executar migração e definir `STORAGE_DRIVER=supabase` |

O Gmail usa OAuth de usuário, não senha. Configure um aplicativo OAuth, autorize sua própria conta e armazene o refresh token com segurança. Para o adaptador de rascunhos use `https://www.googleapis.com/auth/gmail.compose`; para consultas de respostas, `https://www.googleapis.com/auth/gmail.readonly`. O método `createDraft` **escreve um rascunho remoto**, portanto não é exposto na automação atual. `findReplies` retorna IDs de mensagens para classificação futura; respostas no dashboard são registros manuais, não leituras automáticas da caixa de entrada.

OpenAI recebe apenas título do canal, nicho e títulos/datas de até três vídeos, sem contato comercial. Respostas estruturadas são validadas (80–140 palavras, dois portfólios, assunto em uma linha e rejeição de promessas garantidas). O conteúdo ainda exige revisão humana: validadores não podem garantir veracidade/idioma de toda frase. O rascunho anterior é mantido se a IA falhar.

### Supabase/PostgreSQL

1. Crie um projeto Supabase.
2. Execute `supabase/migrations/202611040001_initial.sql` no SQL Editor.
3. Configure URL e **service_role key no backend** e `STORAGE_DRIVER=supabase`.
4. Execute uma pesquisa e confira o histórico no dashboard. Esta etapa real depende de suas credenciais.

Tabelas: `campaigns` (documentos versionados pelo código), `settings`, `suppressions`, `error_events` e `prospecting_lock`. RLS e permissões negam acesso aos papéis `anon`/`authenticated`; o dashboard é de um único operador e acessa a API do backend. A service role nunca é enviada ao navegador. A migração é idempotente. Não migra dados locais automaticamente: use diretórios/projetos separados para demonstração e produção.

Mutações locais usam gravação atômica e lock de arquivo; o Supabase usa lease exclusivo de 15 minutos. A descoberta tem prazo máximo de 6 minutos e chamadas individuais de 20 segundos. Operações concorrentes retornam 409. Após interrupção abrupta, o lock local expira em até 15 minutos. O histórico e os bloqueios são paginados no Supabase para não truncar a deduplicação no limite padrão do PostgREST.

### Rede do ambiente cloud

Além dos domínios de instalação de pacotes/GitHub, integrações reais precisam liberar destinos específicos nas configurações de rede:

- `www.googleapis.com` — YouTube.
- `api.openai.com` — OpenAI.
- `oauth2.googleapis.com` e `gmail.googleapis.com` — OAuth/Gmail, quando usados.
- O hostname exato de `SUPABASE_URL`, como `<projeto>.supabase.co`.

A aplicação respeita o proxy HTTP/HTTPS e os certificados CA do ambiente com `undici`. Não desativa TLS. Use `LLM_API_KEY` se o ambiente reservar o nome `OPENAI_API_KEY`. Configurar domínios ou variáveis não valida automaticamente acesso às APIs.

## Agendamento diário

`.github/workflows/prospect-daily.yml` contém cron **`0 12 * * *`**, equivalente a 09:00 em Fortaleza (UTC−3). O GitHub Actions pode atrasar execuções; o cron não garante pontualidade exata. Use um scheduler de hospedagem persistente se precisar dessa garantia.

Para ativar **apenas descoberta e simulação**:

1. Aplique a migração Supabase.
2. Nas configurações GitHub do repositório, adicione os Actions secrets `YOUTUBE_API_KEY`, `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`.
3. Defina a Actions variable `AUTOMATION_ENABLED=true`.
4. Faça uma execução manual do workflow e confira o resultado antes de depender do cron.

O agendamento só funciona na branch padrão e requer GitHub Actions habilitado. A rotina exige Supabase para preservar histórico/limites entre runners, pesquisa até 100 novos canais e simula os elegíveis com os limites salvos. Tem controle de concorrência no workflow e no banco. Não chama Gmail ou OpenAI automaticamente; as propostas iniciais usam o modelo em inglês com referência real. Não altere o armazenamento para local em runners efêmeros.

## Hospedagem e descadastro

Para escutar externamente, configure `HOST=0.0.0.0`, `API_AUTH_TOKEN` aleatório de pelo menos 32 caracteres e `PUBLIC_ORIGIN=https://seu-dominio` (origem sem caminho). Use um proxy reverso com HTTPS. O dashboard solicita o token e o guarda apenas na memória da aba. Esta é uma aplicação administrativa de um único operador, sem login multiusuário.

O mecanismo público de descadastro já aceita tokens assinados: `GET /unsubscribe?token=...` mostra confirmação, `POST` persiste bloqueio idempotente e suporta corpo `List-Unsubscribe=One-Click`. GET não altera estado. Configure uma `UNSUBSCRIBE_SIGNING_KEY` estável de pelo menos 32 caracteres. `unsubscribeToken(email, key)` está em `src/domain/unsubscribe.ts`. Os tokens não expiram para preservar o direito de descadastro; proteja a chave. Links reais ainda não são inseridos em mensagens nesta versão dry-run. A ação de bloqueio manual no dashboard funciona sem hospedagem pública.

**Envio real ainda depende de uma etapa de ativação futura:** autorização explícita de Daniel, credenciais Google validadas, identidade/endereço comercial e requisitos legais aplicáveis revisados, descadastro público HTTPS testado, política do Gmail conferida e um transporte de envio com tratamento de resultados incertos/idempotência. Nenhuma variável atual ou aprovação de rascunho ativa envio. Essa proteção é intencional nesta entrega de desenvolvimento.

## Estrutura e API

```text
src/
  domain/          # contratos Zod, pontuação, calendário, descadastro
  providers/       # YouTube, OpenAI, Gmail, dados fictícios e HTTP
  repositories/    # arquivos locais e Supabase
  services/        # descoberta, revisão, limites, bloqueios e simulações
  web/             # dashboard TypeScript, HTML e CSS
  app.ts           # API Fastify, autenticação e segurança
  server.ts        # inicialização HTTP
  cli.ts           # execução manual ou agendada
test/              # contratos de API, negócio, segurança e PostgreSQL
supabase/migrations/
.github/workflows/ # CI e prospecção diária
```

| Método | Rota | Uso |
| --- | --- | --- |
| GET | `/health` | Processo em execução; não afirma validação das integrações |
| GET | `/api/dashboard`, `/api/integrations` | Histórico, regras, métricas, erros e presença de configuração |
| POST | `/api/campaigns` | `{ "maxResults": 20, "query": "hardcore" }` |
| GET | `/api/campaigns/:id` | Campanha e evidências |
| POST | `/api/campaigns/:id/simulate` | Simulação idempotente, sem Gmail |
| PUT | `/api/campaigns/:id/leads/:channelId/review` | Revisão com idioma/nicho, evidência e nota de edição |
| PUT | `/api/campaigns/:id/leads/:channelId/contact` | Contato com `sourceUrl`, `note`, `publicBusinessContact: true` |
| POST | `/api/campaigns/:id/leads/:channelId/draft` | Modelo, `{ "useAI": true }` ou `{ "message": { "subject": "…", "body": "…" } }` |
| POST | `/api/campaigns/:id/leads/:channelId/response` | `kind`: `positive`, `negative` ou `unsubscribe`; `note` opcional |
| PUT | `/api/rules` | `{ "rules": { ... }, "complianceReviewed": false }` |
| POST | `/api/suppressions` | `{ "email": "business@example.com" }` |

Com `API_AUTH_TOKEN` configurado, as rotas `/api/` exigem `Authorization: Bearer <token>`. O app limita requisições, valida origem/Host, usa CSP, escapa conteúdo externo no frontend e não registra corpos/credenciais em logs. Erros de provedores são sanitizados.

## Validação

`npm run check` verifica TypeScript estrito, testes de negócio e integrações com mocks, migração em PostgreSQL via PGlite e build. Os testes cobrem pesos, idioma desconhecido, exclusões, canais pequenos, atividade, divisão por nicho, limites globais, duplicidade de e-mail/canal entre dias, locks, persistência, recusas, descadastro assinado, autenticação, erros sanitizados e contratos YouTube/OpenAI/Gmail/Supabase.

O teste PostgreSQL executa a migração duas vezes e verifica RLS, permissões e disputa/expiração do lease. Isso **não substitui** a validação do projeto Supabase remoto. O desenvolvimento e os testes não enviam e-mails nem usam contatos reais.
