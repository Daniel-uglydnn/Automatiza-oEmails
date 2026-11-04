# Daniel · Creator Outreach

Aplicação Node.js/TypeScript para prospecção de criadores de **Minecraft e Roblox em inglês**, com descoberta YouTube, qualificação explicável, propostas personalizadas, OAuth Gmail, envio controlado, Supabase, acompanhamento, CRM e relatórios diários.

O projeto foi ampliado a partir da implementação existente. A especificação principal está em [docs/requirements.md](docs/requirements.md). **Envios reais permanecem desativados por padrão** e nenhuma mensagem real foi enviada durante o desenvolvimento. As integrações foram testadas com provedores simulados; contas externas reais dependem das suas credenciais.

## Executar agora, sem credenciais

Requisitos: Node.js **24.x** e npm. Utilize o checkout existente: o ambiente cloud já é isolado, sem necessidade de criar worktree.

```sh
cd /workspace/Automatiza-oEmails
npm ci
test -f .env || cp .env.example .env
npm run dev
```

O dashboard é servido na porta **3000**, escutando apenas `127.0.0.1` por padrão. A demonstração contém oito canais **fictícios**, com contatos `.invalid`; não são resultados reais. Depois de pesquisar esses oito, eles não são novamente contabilizados como novos. Para outra demonstração independente, use outro `DATA_DIR`, sem apagar o histórico de produção.

```sh
npm run check                    # TypeScript, testes e build
npm run build
npm start                        # servidor compilado
npm run prospect -- --max 8 --simulate
npm run automate -- --simulate   # ciclo completo + relatório, sempre sem envio
npm run format:check
```

`npm run dev` acompanha mudanças do backend. Após editar o frontend, execute `npm run build:web` e recarregue a página.

## O que está implementado

- Descoberta por múltiplas consultas e paginação, orçamento de busca configurável, detalhes em lotes e dez uploads recentes por canal. Termos base incluem Survival, Hardcore, SMP, Challenges, Mods, Funny Moments e os formatos Roblox definidos na especificação; termos observados em títulos retornados orientam consultas subsequentes.
- Dados de canal, inscritos, país **declarado**, frequência, títulos/datas/links de vídeos, views, likes/comentários quando disponíveis, média de views e evidências. Ausência de dados permanece desconhecida, sem inventar números.
- Pontuação 0–100 com pesos configuráveis, sugestões baseadas em metadata e limitação explícita da análise. Pontos de edição exigem observação humana com fonte, não suposição de defeitos.
- Contatos comerciais da descrição pública ou de sites oficialmente vinculados na descrição, com URL, tipo, data e confiança. Coleta de sites exige hosts exatos aprovados, IP público, HTTPS e respeito a robots.txt; não segue redirects, logins ou CAPTCHAs.
- Propostas em inglês, 80–140 palavras sem assinatura legal, referência a upload verificável e os dois portfólios. Modelo com fatos reais ou OpenAI Responses API; o conteúdo externo é referência não confiável, nunca instrução.
- Conexão Gmail com OAuth state de uso único, PKCE, escopos mínimos para envio/acompanhamento e refresh token cifrado em AES-256-GCM. Google access/refresh tokens nunca chegam ao frontend.
- Dispatcher de envio individual com bloqueios de autorização, conta, identidade, descadastro, país e conformidade, cota, deduplicação e pausa. Não exige aprovação de cada mensagem depois da ativação inicial.
- Reserva durável **antes** do POST Gmail, índices únicos de canal e hash de e-mail, Message-ID estável, IDs Gmail e estado reservado/enviado/rejeitado/incerto. POST de envio nunca é repetido automaticamente; reconciliação consulta Enviados sem reenviar.
- Consulta autorizada de respostas no mesmo thread, bloqueio conservador de recusas/descadastros e confirmação humana de positivas, negociação e clientes.
- Dashboard administrativo com métricas, tabela pesquisável, filtros por nicho/inscritos/pontuação/status/data, histórico de mensagens, exclusões, pausa/retomada, CSV protegido contra fórmulas e relatórios com top dez oportunidades.
- Worker diário persistente, retomada, exclusividade de execução, fila de propostas pendentes, backoff de leituras e relatório por execução. Resumo ao próprio e-mail é opcional e também depende de autorização.
- Retenção configurável, logs estruturados/sanitizados, RLS, rate limits, validação Zod, proteção de Host/Origin, CSP e escape de conteúdo no painel.

## Regras padrão

| Parâmetro                      | Padrão                                                      |
| ------------------------------ | ----------------------------------------------------------- |
| Novos canais/dia               | Até 100; nunca preencher com dados fictícios                |
| Distribuição inicial           | 50% Minecraft, 50% Roblox; ajustável                        |
| Idioma                         | Inglês predominante; português excluído                     |
| País                           | BR excluído; preferência US, GB, CA, AU, NZ, IE             |
| Inscritos prioritários         | 2.000–500.000, sem exclusão automática fora da faixa        |
| Atividade                      | Prioridade em 30 dias; máximo 60                            |
| Pontuação mínima               | 70                                                          |
| Contatos/dia                   | Inicialmente 10; teto 100                                   |
| Pesos                          | Nicho 20, atividade 20, comercial 20, edição 25, contato 15 |
| Busca YouTube                  | Até 12 search.list/execução, configurável 2–30              |
| Agenda                         | 09:00, America/Fortaleza (`0 12 * * *` UTC)                 |
| Follow-ups                     | Desativados                                                 |
| Retenção de conteúdo não ativo | 90 dias, configurável 30–730                                |
| Envio                          | `DELIVERY_MODE=dry-run`, `ENABLE_LIVE_SENDS=false`          |

O objetivo é pesquisar/qualificar até 100 canais, **não enviar 100 e-mails**. Canais não qualificados ficam registrados com motivos. Se a quantidade real for menor, o relatório mostra a diferença; não amplia cota nem inventa contatos para completar números.

As regras ficam em `src/domain/models.ts` e são persistidas pelo dashboard em armazenamento local ou `settings` do Supabase. Pesos precisam somar 100. Aumentar o limite de contato exige registrar revisão de conformidade, qualidade e reputação. Isso não habilita envio real.

### Evidências e limitações da pontuação

- Inglês predominante: maioria da amostra com `defaultAudioLanguage=en...`, ou revisão explícita com fonte. `regionCode` e título em inglês **não provam** idioma; idioma não prova país.
- Nicho: maioria dos títulos da amostra confirma Minecraft/Roblox ou revisão com fonte. “Doors” sozinho é ambíguo.
- Atividade: até 70% do peso por publicação em 30 dias e 30% por frequência de até quatro uploads/30 dias. Entre 31–60 dias: 40% do peso.
- Comercial: heurística de inscritos (55% na faixa, 25% fora, zero se ocultos), views medianas (até 25%), interação por likes/comentários quando verificável (até 10%) e país declarado prioritário (10%). Não prova orçamento ou intenção de compra.
- Edição: nota humana 0–1 × peso, com observação concreta e URL. Sem assistir/analisar o vídeo, apenas sugestões condicionais baseadas no formato; zero pontos de edição.
- Contato: publicação comercial com fonte. O envio exige confiança/data, contato verificado em até 30 dias e país com regra legal configurada. Fontes antigas migradas sem data precisam de reverificação.

Os portfólios informados são incluídos integralmente: `https://uglydnn.carrd.co/` e `https://ytjobs.co/talent/profile/565434?r=94`. O acesso a eles foi bloqueado por política de rede neste ambiente; nenhuma experiência, resultado ou característica visual de seu conteúdo foi presumida.

## Integrações e operação real

| Serviço     | Variáveis principais                                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| YouTube     | `YOUTUBE_API_KEY`, `APP_MODE=live`                                                                                         |
| OpenAI      | `LLM_API_KEY` ou `OPENAI_API_KEY`, `OPENAI_MODEL`                                                                          |
| Gmail       | `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`; refresh token via consentimento ou bootstrap seguro |
| Supabase    | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STORAGE_DRIVER=supabase`                                                     |
| Dashboard   | `API_AUTH_TOKEN`, `PUBLIC_ORIGIN`, `HOST`                                                                                  |
| Descadastro | `UNSUBSCRIBE_SIGNING_KEY` estável + domínio público HTTPS                                                                  |

`APP_MODE=live` ativa **descoberta real**, sem alterar a autorização de envio. Em ambiente restrito, libere os destinos exatos descritos em [deploy](docs/deployment.md), preservando a lista de rede existente. A aplicação usa o proxy/CA do ambiente, sem desativar TLS.

1. Aplique as duas migrações Supabase, configure credenciais e teste descoberta real em dry-run.
2. Siga [Google Cloud e conexão Gmail](docs/google-setup.md).
3. Siga [implantação e agendamento](docs/deployment.md), mantendo envio desativado.
4. Revise identidade/endereço, regras por país, qualidade das propostas e funcionamento do descadastro.
5. **Somente depois da sua decisão explícita**, habilite os dois controles do servidor e registre a autorização inicial no painel. Nenhum país vem autorizado e não se infere uma base legal.

O painel não consegue mudar `ENABLE_LIVE_SENDS`; a autorização inicial também não contorna o controle do servidor. Alterar identidade ou jurisdições revoga a liberação anterior. Falhas de conta/limite/resultado incerto param o dispatcher. Não se usa outra conta para contornar restrições.

O worker considera também propostas pendentes de campanhas anteriores, reavaliando atividade e critérios. A reserva de um canal/endereço nunca é apagada automaticamente, mesmo em timeout ou rejeição. A aplicação adota **no máximo uma tentativa automática**, em vez de prometer entrega “exactly once”, que a API Gmail não oferece. Ausência de correspondência na reconciliação não permite nova tentativa automática.

## Dashboard, relatórios e privacidade

O painel mostra contagens provenientes do armazenamento, distinguindo simulação e Gmail confirmado. Respostas positivas/negociação/clientes exigem confirmação do operador; as taxas usam apenas envios confirmados e mostram “—” quando não existe denominador. Nenhuma receita ou conversão é inventada.

Cada ciclo gera relatório persistido com quantidade real de canais, nichos, contatos, propostas, envios/simulações, motivos de bloqueio, respostas, erros e as dez melhores oportunidades. No fluxo real, a contagem de envios inclui a fila antiga processada pela execução. O relatório no painel é disponível mesmo em erro; pausas geram execução `skipped`.

O resumo opcional só pode ir ao próprio e-mail comercial, nunca a terceiros, e ocupa um lugar da cota. Não é enviado em simulação. O descadastro público funciona com tokens assinados: GET confirma sem mutação, POST registra exclusão sem exigir login, inclusive sob lock de descoberta.

A retenção minimiza corpos, descrições e contatos não ativos após o prazo, preservando IDs/hashes para deduplicação e dados mínimos de bloqueio/auditoria. Resultados incertos e negociações ativas são preservados para resolução. Consulte o guia de operação antes de remover histórico ou trocar chaves.

## Arquitetura

```text
src/domain/        contratos, pontuação, política, calendário e criptografia
src/providers/     YouTube, OpenAI, Gmail, websites públicos, HTTP/backoff
src/repositories/  arquivos locais e Supabase com reservas únicas
src/services/      descoberta, análise, OAuth, conformidade, envio,
                   acompanhamento, relatórios, retenção e automação
src/web/           dashboard TypeScript/HTML/CSS
src/run.ts         ciclo completo para scheduler
src/cli.ts         descoberta/simulação simples
test/              testes de negócio, APIs, segurança e PostgreSQL/PGlite
supabase/migrations/
deploy/            exemplo de hospedagem Docker
.github/workflows/ CI e agendamento diário
docs/              especificação, Google/OAuth e operação
```

Foi preservado Fastify com frontend TypeScript empacotado por esbuild: este painel administrativo não exige SSR, então migrar para Next/React aumentaria a superfície e descartaria trabalho sem benefício funcional. Supabase oficial + Zod e migrações SQL substituem ORM; `node:test` substitui Jest/Vitest, com testes reais de integração em PostgreSQL/PGlite. Não há arquitetura distribuída desnecessária.

## APIs principais

Todas as rotas `/api/` exigem Bearer token quando `API_AUTH_TOKEN` está configurado. Hospedagem externa exige token com pelo menos 32 caracteres, origem pública HTTPS e Host correspondente. O login administrativo não entrega chaves Google/OpenAI/Supabase ao navegador.

| Rotas                                                         | Função                                         |
| ------------------------------------------------------------- | ---------------------------------------------- |
| `GET /health`                                                 | Processo, sem afirmar saúde de APIs externas   |
| `GET /api/dashboard`, `/api/integrations`                     | Métricas, histórico e presença de configuração |
| `POST /api/campaigns`, `GET /api/campaigns/:id`               | Descoberta e evidências                        |
| `POST /api/campaigns/:id/simulate`                            | Simulação sem Gmail                            |
| `PUT /api/campaigns/:id/leads/:channelId/review`, `/contact`  | Revisão e contato comercial com fonte          |
| `POST /api/campaigns/:id/leads/:channelId/draft`, `/response` | Proposta e registro manual de resposta         |
| `PUT /api/rules`, `POST /api/suppressions`                    | Critérios e exclusões                          |
| `GET/PUT /api/operations`                                     | Pausa, identidade, jurisdições e política      |
| `POST /api/operations/authorize`, `/revoke`                   | Autorização inicial explícita/revogação        |
| `POST /api/gmail/connect`, `/api/gmail/validate`              | OAuth ou validação de bootstrap                |
| `GET /oauth/gmail/callback`                                   | Callback com state/PKCE de uso único           |
| `POST /api/automation/run`                                    | `{ "simulate": true }` por padrão              |
| `POST /api/tracking/sync`, `/api/deliveries/reconcile`        | Leitura Gmail e reconciliação                  |
| `PUT /api/deliveries/:id/stage`                               | Confirmação de resultado comercial             |
| `GET /api/reports`, `/api/reports/:id`, `/api/export.csv`     | Relatórios e exportação                        |
| `GET/POST /unsubscribe?token=...`                             | Descadastro público assinado                   |

## Estado de validação e dependências externas

`npm run check` executa TypeScript estrito, testes com dados simulados, migrações PostgreSQL e build. Os testes cobrem deduplicação por canal/e-mail, idioma e pontuação, contatos públicos/robots/SSRF, personalização, criptografia/OAuth, guardas legais, cotas globais, descadastro sob lock, reservas antes do envio, interrupção após aceite, reconciliação sem reenvio, respostas/CRM, ciclo diário idempotente, pausa, backlog, CSV e retenção.

O PostgreSQL/PGlite verifica migrações repetíveis, RLS, permissões, leases e unicidade de reservas. Isso não prova conectividade com um Supabase remoto. O transporte Gmail é exercitado com mocks, sem e-mails reais. Os testes e o servidor Node são executáveis independentemente das credenciais.

Ainda dependem de você: chaves/API quotas, projeto Supabase e migrações remotas, OAuth/consentimento Google, hostname HTTPS/hospedagem, revisão legal por país, identidade/endereço, chaves estáveis e ativação consciente do agendamento/envio. A infraestrutura não foi implantada nem o envio ativado automaticamente. Não há afirmação de que APIs remotas funcionem sem esses testes de conta.
