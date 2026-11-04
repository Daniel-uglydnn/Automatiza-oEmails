# Implantação e operação diária

O projeto contém um servidor web persistente e um worker independente. Supabase é a fonte de verdade compartilhada; processos e filesystem de runners GitHub são descartáveis. A implantação e a ativação não foram executadas neste desenvolvimento, pois dependem de sua conta, domínio e credenciais.

## Supabase

1. Crie um projeto PostgreSQL/Supabase e aplique, nesta ordem, as migrações `202611040001_initial.sql` e `202611040002_automation.sql` no SQL Editor. Ambas são idempotentes e preservam campanhas antigas.
2. Configure `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` apenas no servidor/runner; use `STORAGE_DRIVER=supabase`.
3. As tabelas têm RLS e acesso negado a `anon`/`authenticated`. A service role de backend é necessária. `deliveries.channel_id` e `deliveries.email_key` têm unicidade independente: mesmo com dois processos concorrentes, a segunda reserva é recusada.
4. `app_records` guarda operações, credencial cifrada, OAuth states, execuções e notificações. Não exponha essa tabela via chave anônima. Ative backups e monitore acesso administrativo.

## Servidor

Use uma VM, container ou hospedagem Docker de serviço web, como Render. Evite funções serverless de curta duração para o worker, que pode processar vários minutos.

O `Dockerfile` usa build em duas etapas, Node 24, dependências de produção e usuário sem root. `.dockerignore` impede incluir `.env`, Git e dados locais na imagem. `deploy/render.yaml` é um exemplo revisável; para Blueprint selecione esse arquivo ou configure um Web Service Docker apontando para este repositório.

Configure:

- `HOST=0.0.0.0`, `PORT` fornecida pelo provedor. No Render, deixe `PUBLIC_ORIGIN` vazio para usar automaticamente `RENDER_EXTERNAL_URL`, fornecida pela plataforma. Para domínio personalizado, configure `PUBLIC_ORIGIN=https://seu-dominio` sem caminho; esse valor tem prioridade.
- `API_AUTH_TOKEN` aleatório de pelo menos 32 caracteres. Ele protege todas as rotas `/api/`; os tokens Google nunca são enviados ao frontend. O token administrativo digitado fica somente na memória da aba.
- Chaves YouTube/OpenAI/Supabase e OAuth descritas no `.env.example` e em [Google setup](google-setup.md).
- Chaves estáveis `CREDENTIAL_ENCRYPTION_KEY` e `UNSUBSCRIBE_SIGNING_KEY`, compartilhadas com o agendamento.
- Inicialmente `DELIVERY_MODE=dry-run` e `ENABLE_LIVE_SENDS=false`.

O reverse proxy deve preservar o header Host da origem configurada e servir TLS. `/health` verifica o processo; não atesta APIs externas. O healthcheck do container usa o Host de `PUBLIC_ORIGIN` para respeitar a proteção contra DNS rebinding. Nenhuma alteração do ambiente cloud é publicada automaticamente por commits.

Para uma VM sem Docker:

```sh
npm ci
npm run check
npm start
```

Use o gerenciador de processos do provedor para reiniciar `node dist/server.js`, injetando variáveis seguras. Reiniciar o servidor não apaga o banco nem autoriza envios.

## GitHub Actions às 09:00

O workflow `.github/workflows/prospect-daily.yml` executa `0 12 * * *`, equivalente a 09:00 em `America/Fortaleza`. O GitHub pode atrasar cron; para horário estrito, use um scheduler do provedor chamando `npm run automate -- --scheduled` com as mesmas variáveis. Use **um scheduler**, embora os locks também protejam contra concorrência.

No GitHub, configure Actions secrets:

```text
YOUTUBE_API_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
LLM_API_KEY                    # opcional; sem ela usa modelo personalizado
GMAIL_CLIENT_ID                # necessários quando conectar Gmail
GMAIL_CLIENT_SECRET
CREDENTIAL_ENCRYPTION_KEY
UNSUBSCRIBE_SIGNING_KEY
API_AUTH_TOKEN
```

O refresh token conectado pelo painel já estará cifrado no Supabase, não precisa ser copiado para o GitHub. Configure Actions variables:

```text
AUTOMATION_ENABLED=true        # somente quando quiser começar a rotina
PUBLIC_ORIGIN=https://seu-dominio
DELIVERY_MODE=dry-run
ENABLE_LIVE_SENDS=false
CONTACT_ALLOWED_HOSTS=        # hosts exatos e opcionais de sites oficiais
```

O workflow permanece inativo enquanto `AUTOMATION_ENABLED` não for `true`. Faça uma execução manual em dry-run, confira relatório e cota; autorize envio real só seguindo a etapa específica do guia Google. As regras, pausa e limites vêm do banco e valem tanto no servidor quanto no runner.

Cada dia de Fortaleza tem uma chave de execução durável. Uma execução concluída não é repetida; uma interrompida pode retomar a mesma campanha após o lock expirar, sem reenviar tentativas reservadas. Há concorrência exclusiva no GitHub e lease de execução de 30 minutos no banco. O worker deixa de iniciar novas etapas após cerca de 11 minutos e o workflow tem timeout de 12 minutos. Não inicie outro runner para “furar” um lock.

Propostas pendentes de dias anteriores também são consideradas pela fila real, desde que ainda atendam aos critérios atuais, contato recente e jurisdição permitida. Envios reservados/sent/unknown/rejected nunca voltam a primeiros contatos. Simulações são um histórico separado e não fingem entrega real.

## Rede, observabilidade e privacidade

No ambiente cloud restrito, adicione nas configurações os destinos necessários sem remover entradas existentes:

- `www.googleapis.com` — YouTube.
- `api.openai.com` — geração de propostas.
- `accounts.google.com`, `oauth2.googleapis.com`, `gmail.googleapis.com` — consentimento/OAuth/Gmail.
- Hostname exato do projeto Supabase e o próprio domínio público para validar descadastro.
- Apenas hosts oficiais aprovados em `CONTACT_ALLOWED_HOSTS`, para coleta de contato permitida.

Use o proxy e CA fornecidos pelo ambiente; nunca desative TLS. Descoberta usa consultas/paginação com orçamento configurado e lotes de detalhes; leituras temporariamente indisponíveis têm até duas tentativas adicionais com backoff. **Envio Gmail não tem retry.**

Logs estruturados do worker incluem somente ID/status da execução e contagens. Erros externos são sanitizados. O painel mostra relatórios, motivos de bloqueio, IDs Gmail, respostas e CRM. Por prudência, snippets de resposta que contenham recusa/descadastro bloqueiam o contato; respostas positivas, negociação e clientes exigem confirmação humana. Não se estima conversão sem base de envios confirmados.

A retenção padrão é 90 dias, configurável entre 30 e 730. Após o prazo, descrições e corpos são minimizados para registros sem negociação ativa. IDs de canal e hashes de endereço/tentativa são preservados para nunca recontatar. Dados necessários a bloqueios e auditoria mínima continuam retidos; negociações ativas e resultados incertos ficam disponíveis para resolução. Não use a exclusão do histórico como mecanismo de reenvio.

O resumo por e-mail é opcional, só vai ao mesmo endereço da conta comercial validada e usa uma reserva própria por execução, consumindo a cota diária. Em dry-run ele não é enviado. Quando habilitado, um lugar do limite é reservado para o resumo; com limite de 10, no máximo 9 propostas mais 1 resumo.
