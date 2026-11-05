# Google Cloud e conexão Gmail

Nenhuma senha Gmail é usada. YouTube usa API key; Gmail usa OAuth de usuário. Os tokens Google ficam somente no backend, cifrados com AES-256-GCM no banco. Não copie valores para issues, commits ou chat.

## 1. Projeto e APIs

1. Crie/selecione um projeto em Google Cloud Console.
2. Habilite **YouTube Data API v3** e **Gmail API**.
3. Em Credentials, crie uma API key restrita a YouTube Data API v3; quando a hospedagem oferecer saída IP fixa, restrinja também o IP. Configure `YOUTUBE_API_KEY` no gerenciador seguro de variáveis e `APP_MODE=live` para descoberta real.
4. Confira a cota YouTube disponível. `search.list` custa 100 unidades; `youtubeSearchBudget` limita buscas por execução. O padrão é 12 buscas, até 100 canais, 10 uploads por canal e detalhes de vídeos em lotes de 50. Contas e projetos podem ter cotas diferentes; nenhuma rotação de contas é implementada.

## 2. Aplicativo OAuth

1. Configure Google Auth Platform / consent screen, contatos e domínios do seu aplicativo.
2. Crie um OAuth client do tipo **Web application**.
3. Cadastre o callback exatamente como `https://seu-dominio/oauth/gmail/callback`. Para desenvolvimento local use `http://127.0.0.1:3000/oauth/gmail/callback` e abra o dashboard nesse hostname.
4. Configure `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` e `PUBLIC_ORIGIN` HTTPS na hospedagem. Em desenvolvimento local sem origem pública, o callback usa `127.0.0.1:PORT`.
5. Gere uma chave AES de 32 bytes, por exemplo `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`, e armazene-a como `CREDENTIAL_ENCRYPTION_KEY`. O comando imprime uma nova chave para você guardar com segurança; não cole a saída em logs compartilhados. Use a **mesma chave estável** no servidor e no agendamento. Sem ela os tokens salvos não podem ser descriptografados.
6. Em modo de testes Google, adicione sua conta como test user. Aplicativos externos com escopos Gmail podem exigir verificação e cumprir a política de dados de usuários do Google para produção. Refresh tokens de apps externos em Testing podem expirar após sete dias; não considere esse modo adequado à operação recorrente definitiva.

Escopos solicitados pela aplicação: `gmail.send` e `gmail.readonly`. O segundo é necessário para consultar threads e identificar respostas/remoções. A aplicação não solicita senha ou acesso irrestrito à conta. O método legado de rascunhos remotos exige `gmail.compose` adicional e não é utilizado pela rotina atual.

## 3. Consentimento inicial

1. Mantenha `DELIVERY_MODE=dry-run` e `ENABLE_LIVE_SENDS=false`.
2. Entre no dashboard com o token administrativo. Clique **Conectar Gmail** e autorize sua conta Google.
3. O servidor valida state de uso único, PKCE, prazo de dez minutos, escopos e endereço retornado por `users.getProfile`; salva o refresh token cifrado. O callback não exibe access/refresh tokens no navegador.
4. Confira o e-mail conectado no painel. Conectar Gmail **não autoriza envio comercial**.

Se você já possui um refresh token autorizado, pode configurá-lo como `GMAIL_REFRESH_TOKEN` e clicar **Validar credenciais do ambiente**. O servidor confirma perfil/escopos e armazena uma cópia cifrada; o token precisa ter acesso offline e os dois escopos. Se faltarem permissões, faça novo consentimento. Remova a variável de bootstrap depois, se preferir usar somente o token cifrado.

## 4. Ativação futura, depois da validação

Antes da ativação, é possível validar o descadastro sem endereço postal e sem enviar mensagens: em **Operação e autorização**, clique em **Testar descadastro**. O servidor acessa a página pública HTTPS e faz o POST de exclusão usando um endereço fictício exclusivo em `example.invalid`. O teste só é aprovado se o bloqueio estiver persistido no banco. O painel informa a data da última validação; esse teste não concede autorização inicial e não altera `DELIVERY_MODE` ou `ENABLE_LIVE_SENDS`. A exclusão fictícia aparece identificada como teste na lista de bloqueios.

1. Revise no dashboard identidade comercial, e-mail conectado, endereço postal e regras legais de cada país. Nenhum país vem autorizado. País BR e país desconhecido não recebem envio automático.
2. Publique o dashboard por HTTPS e configure `PUBLIC_ORIGIN` e `UNSUBSCRIBE_SIGNING_KEY` estável. Teste GET de confirmação e POST de descadastro assinado. GET não altera estado; POST funciona sem login e bloqueia o endereço globalmente, inclusive durante pesquisas.
3. Verifique qualidade e fatos das propostas em dry-run e confirme conformidade, reputação, regras do Gmail e requisitos específicos dos destinatários. A aplicação não decide uma base legal por você.
4. Somente após sua decisão explícita, altere na hospedagem e no runner `DELIVERY_MODE=live` e `ENABLE_LIVE_SENDS=true`.
5. No painel, registre a autorização inicial com os três reconhecimentos e o texto `AUTHORIZE_AUTOMATIC_OUTREACH`. O backend valida novamente perfil/scopes e acessibilidade do endpoint HTTPS de descadastro. Só então grava a autorização.
6. A rotina diária pode enviar propostas individuais elegíveis, sem aprovação manual por mensagem, dentro de 10/dia inicialmente. Não realiza follow-ups.

O painel oferece **Revisão dos países de destino** para registrar cada país sem editar JSON: escolha o país, consulte a orientação oficial disponível, descreva a base e os requisitos aplicáveis aos seus destinatários, informe a fonte HTTPS e confirme a revisão. Não basta disponibilizar um e-mail publicamente para presumir permissão. A data é registrada pelo servidor após a confirmação; nenhum país é liberado por padrão e a aplicação não verifica automaticamente a legalidade do contato. A configuração avançada em JSON permanece disponível para outros países e integrações existentes.

Salve primeiro a identidade e as revisões dos países, depois execute **Testar descadastro** novamente. Registrar, editar ou remover regras de países revoga a autorização anterior e a validação do descadastro, preservando os demais dados comerciais. Registrar uma revisão, por si só, não habilita o envio real.

Alterar identidade/jurisdições revoga a autorização. Pausar interrompe novos envios; uma mensagem já em trânsito não pode ser retirada. Falhas de autenticação, restrição ou resultado incerto abrem o bloqueio operacional e exigem nova validação/autorização. Nunca se repete automaticamente um POST de envio.

## 5. Recuperação

- Consulte **Histórico de entrega** e **Reconciliar resultados incertos**.
- O servidor pesquisa a cópia em Enviados pelo `Message-ID` estável reservado antes do envio. Uma única correspondência confirma o ID Gmail; nenhuma correspondência **não prova falha** e não reabre a fila.
- Reservas, rejeições e resultados incertos continuam bloqueando o mesmo canal e endereço. Não exclua essas linhas para “tentar de novo”.
- Refazer consentimento/rotacionar chaves não é motivo para descartar a deduplicação. Preserve backups do banco e das chaves de criptografia/descadastro, com acesso mínimo.
