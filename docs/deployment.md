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

### Primeiro teste manual, sem ativar a agenda ou enviar e-mails

1. No repositório, abra **Settings → Secrets and variables → Actions → Secrets → New repository secret**. Cadastre `YOUTUBE_API_KEY`, `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` com os mesmos valores já utilizados no Render. A URL do Supabase é a base `https://seu-projeto.supabase.co`, sem `/rest/v1/`. Esses três secrets bastam para testar a descoberta e o banco; não copie segredos para issues, commits ou mensagens de chat.
2. Abra **Actions → Prospecção diária (dry-run por padrão) → Run workflow**, escolha `main` e mantenha **Simular sem enviar e-mails** marcado. O teste manual funciona com a agenda diária desativada e força a simulação mesmo que as variáveis de envio tenham sido alteradas anteriormente.
3. Confira o resultado no GitHub e no painel, em **Relatórios de execução**. O relatório de teste deve ter **Enviados 0**. Se não houver leads elegíveis, **Simulados 0** também é válido: consulte os motivos de bloqueio. Se a automação estiver pausada, o relatório informará a pausa.

Esse teste usa uma execução identificada como `manual:...`, sem consumir a execução diária. As simulações continuam respeitando o histórico e a cota global de contatos. Nenhum país ou autorização de envio é cadastrado pelo teste. O workflow lista os nomes dos secrets obrigatórios que estiverem faltando, sem imprimir os valores.

### Configuração da rotina diária

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

A agenda diária permanece inativa enquanto `AUTOMATION_ENABLED` não for `true`; o teste manual descrito acima funciona sem essa variável. Faça uma execução manual em simulação, confira relatório e cota; autorize envio real só seguindo a etapa específica do guia Google. Desmarcar a simulação no teste manual usa a configuração normal do runner e todas as suas guardas de envio. As regras, pausa e limites vêm do banco e valem tanto no servidor quanto no runner.

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

Os logs estruturados do worker não incluem credenciais nem endereços de contato. Erros externos são sanitizados. O painel mostra relatórios, motivos de bloqueio, IDs Gmail, respostas e CRM. Por prudência, snippets de resposta que contenham recusa/descadastro bloqueiam o contato; respostas positivas, negociação e clientes exigem confirmação humana. Não se estima conversão sem base de envios confirmados.

O resumo `automation.completed` informa também o modo de execução, a flag de envio real, os totais de qualificados/contatos/propostas e os motivos agregados de bloqueio, sem endereços de contato ou credenciais. Uma execução concluída com zero erros pode ter zero envios por causa das regras. Reexecutar um dia já concluído imprime `automation.already_completed` com o relatório existente, sem repetir a rotina ou reabrir contatos.

Em **Relatórios de execução**, **Atualizar relatórios** consulta os dados atuais sem disparar a automação. A data da última consulta ajuda a identificar uma aba desatualizada. Encontrados e qualificados contam a pesquisa nova; os bloqueios podem incluir o histórico reavaliado e vários motivos para o mesmo canal. O resumo das melhores oportunidades nos novos relatórios inclui os bloqueios de envio além dos critérios de qualificação. Ter pontuação suficiente não dispensa país autorizado, fonte do contato, histórico e demais verificações. Os cartões de integração mostram presença de credenciais; a autorização de envio do Gmail acompanha a seção operacional.

A retenção padrão é 90 dias, configurável entre 30 e 730. Após o prazo, descrições e corpos são minimizados para registros sem negociação ativa. IDs de canal e hashes de endereço/tentativa são preservados para nunca recontatar. Dados necessários a bloqueios e auditoria mínima continuam retidos; negociações ativas e resultados incertos ficam disponíveis para resolução. Não use a exclusão do histórico como mecanismo de reenvio.

O resumo por e-mail é opcional, só vai ao mesmo endereço da conta comercial validada e usa uma reserva própria por execução, consumindo a cota diária. Em dry-run ele não é enviado. Quando habilitado, um lugar do limite é reservado para o resumo; com limite de 10, no máximo 9 propostas mais 1 resumo.
