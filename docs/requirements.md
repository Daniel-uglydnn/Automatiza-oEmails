# PROJETO: AUTOMAÇÃO INTELIGENTE DE PROSPECÇÃO DE CLIENTES NO YOUTUBE

## 1. Seu papel e objetivo

Atue como um engenheiro de software sênior, especialista em automação, APIs, desenvolvimento full-stack, inteligência artificial e aquisição de clientes B2B.

Quero que você **desenvolva uma aplicação completa, funcional e preparada para execução automática diária**, cujo objetivo seja encontrar potenciais clientes para meus serviços profissionais de edição de vídeos.

Não quero apenas um planejamento, pseudocódigo ou explicações. Quero que você implemente o projeto, organize os arquivos, escreva o código, configure testes e prepare a implantação.

A automação deverá:

1. Descobrir até 100 novos canais qualificados do YouTube diariamente.
2. Concentrar as pesquisas nos nichos Minecraft e Roblox.
3. Identificar canais que publiquem conteúdo em inglês.
4. Analisar os canais para identificar oportunidades reais de edição.
5. Localizar endereços de e-mail comerciais disponibilizados publicamente.
6. Preparar propostas comerciais personalizadas em inglês.
7. Enviar automaticamente as propostas elegíveis pelo Gmail, após a configuração inicial e autorização.
8. Registrar cada contato para impedir duplicidades.
9. Acompanhar respostas, solicitações de remoção e resultados.
10. Gerar um relatório diário de desempenho.

O objetivo não é simplesmente enviar o maior número possível de mensagens, mas conseguir clientes internacionais recorrentes que precisem de um editor de vídeos.

## 2. Minhas informações profissionais

**Nome profissional:** Daniel

**Profissão:** Editor de vídeos freelancer.

**Especialização:** Edição de vídeos para YouTube, principalmente conteúdo de games, Minecraft e Roblox.

**Público-alvo:** YouTubers internacionais que produzam vídeos em inglês.

**Portfólios:**

- https://uglydnn.carrd.co/
- https://ytjobs.co/talent/profile/565434?r=94

Utilize esses dois links nas minhas propostas comerciais.

Se possível, examine o conteúdo acessível dos portfólios para entender meu estilo de edição. Se algum portfólio não puder ser acessado, não invente informações sobre seu conteúdo.

Minha proposta de valor deve destacar os benefícios de uma edição profissional, incluindo ritmo narrativo, retenção, timing cômico, efeitos sonoros, transições e uma experiência mais envolvente para o espectador, sempre que essas capacidades forem realmente demonstradas pelo meu trabalho.

Não invente experiência profissional, resultados de clientes, números de visualizações ou depoimentos.

## 3. Descoberta automática de canais

Utilize preferencialmente a YouTube Data API v3.

Pesquise termos relevantes, incluindo:

- Minecraft survival
- Minecraft hardcore
- Minecraft SMP
- Minecraft funny moments
- Minecraft challenges
- Minecraft modded survival
- Roblox gameplay
- Roblox funny moments
- Roblox challenges
- Roblox horror games
- Roblox Brookhaven
- Roblox Blox Fruits
- Roblox Fisch
- Roblox Doors
- Roblox Dress to Impress

Amplie dinamicamente os termos de pesquisa com jogos, tendências e formatos relevantes, desde que correspondam ao nicho e tenham sido identificados em fontes verificáveis.

**Meta: 100 novos canais qualificados diariamente.**

Para cada canal, colete, quando disponível:

- Nome e ID único do canal.
- URL oficial.
- Número de inscritos.
- Número total de vídeos.
- Média aproximada de visualizações recentes.
- Títulos e links dos vídeos recentes.
- Data do vídeo mais recente.
- Frequência de publicação.
- Idioma predominante.
- Principal jogo abordado.
- Descrição do canal.
- País, somente quando verificável.
- Evidências de oportunidades para meus serviços.
- Pontuação de compatibilidade comercial.

Dê preferência a canais ativos, com publicações nos últimos 30 a 60 dias.

Priorize canais de aproximadamente 2 mil a 500 mil inscritos, mas não exclua automaticamente canais menores ou maiores que demonstrem potencial comercial.

Não selecione canais brasileiros ou predominantemente em português.

Use múltiplas consultas e paginação com controle de cotas. Não faça requisições desnecessárias.

Não invente canais e não conte canais encontrados anteriormente como novos.

Se não existirem 100 canais que satisfaçam os critérios, apresente o número real encontrado e os motivos da diferença.

## 4. Avaliação inteligente dos canais

Implemente um sistema de classificação de oportunidades com pontuação de 0 a 100.

Critérios sugeridos:

- Compatibilidade com Minecraft ou Roblox: 20 pontos.
- Publicações frequentes e recentes: 20 pontos.
- Potencial comercial e engajamento: 20 pontos.
- Oportunidades identificáveis de edição: 25 pontos.
- Disponibilidade de contato comercial: 15 pontos.

A análise deve identificar oportunidades como:

- Conteúdo que poderia ter um ritmo mais dinâmico.
- Possibilidade de melhorar a apresentação de momentos engraçados.
- Uso potencial de legendas, zooms e efeitos sonoros.
- Melhor organização narrativa de desafios.
- Maior destaque visual para acontecimentos importantes.

**Importante:** não afirme que um vídeo apresenta defeitos sem tê-lo realmente analisado.

Caso só seja possível acessar títulos, descrições e metadados, produza sugestões fundamentadas nessas informações e identifique a limitação.

Dê prioridade aos canais com maior probabilidade de precisar e contratar serviços de edição.

## 5. Localização de e-mails comerciais

Desenvolva um módulo responsável por identificar os canais de contato apropriados para propostas profissionais.

Consulte apenas fontes públicas e acessíveis de maneira autorizada, como:

- Sites profissionais vinculados oficialmente ao canal.
- Páginas públicas de contato comercial.
- Informações comerciais disponibilizadas pelo próprio criador.
- Sites de agências ou gerenciadores representantes do canal.

Registre:

- E-mail comercial.
- URL exata de origem.
- Tipo de contato.
- Data de verificação.
- Grau de confiança de que o contato pertence ao canal.

Não invente e-mails usando combinações de nomes e domínios.

Não utilize e-mails privados, vazados ou provenientes de bases compradas. Não contorne CAPTCHAs, sistemas de login, bloqueios ou mecanismos anti-automação.

Não considere obrigatório encontrar 100 e-mails todos os dias. A meta de pesquisa é de 100 canais; o número de contatos elegíveis dependerá da disponibilidade e das regras aplicáveis.

## 6. Geração de mensagens comerciais personalizadas

Implemente um módulo de IA para criar propostas comerciais profissionais em inglês.

Use inglês americano natural, amigável, convincente e sem formalidade excessiva.

Cada mensagem deve ser individualizada com base em informações verificadas sobre o canal.

Estrutura da abordagem:

**Assunto:** curto, natural e específico ao canal.

**Abertura:** cumprimente o criador pelo nome ou nome do canal.

**Personalização:** mencione um vídeo, série ou característica verificável que demonstre familiaridade real com o conteúdo.

**Apresentação:** apresente-me como Daniel, editor de vídeos especializado em conteúdo para YouTube.

**Proposta de valor:** explique como minha edição poderia contribuir para o conteúdo daquele criador.

**Portfólio:** inclua os dois links fornecidos.

**Chamada para ação:** convide o criador a conversar sobre uma possível colaboração.

Exemplo de estilo:

"Hey [Creator Name]!

I came across your channel and noticed your recent [verified video or series]. I really like the direction you're taking with your content.

I'm Daniel, a video editor who works with gaming content, especially Minecraft and Roblox.

I think I could help make your videos even more engaging through tighter pacing, well-timed sound effects, and editing that highlights the best moments.

Here are my portfolios:

https://uglydnn.carrd.co/

https://ytjobs.co/talent/profile/565434?r=94

Would you be open to discussing a possible collaboration?

Best,
Daniel"

Esse texto serve apenas como referência.

Não envie a mesma mensagem genérica a todos os canais.

Evite:

- Linguagem excessivamente comercial.
- Elogios inventados.
- Promessas de resultados garantidos.
- Críticas agressivas à edição atual.
- Assuntos enganosos.
- Textos muito longos.
- Abordagens que pareçam geradas em massa.

Prefira mensagens de aproximadamente 80 a 140 palavras, sem contar assinatura e informações obrigatórias.

Se não houver elementos suficientes para uma personalização genuína, não envie automaticamente.

## 7. Integração com Gmail

Implemente o envio utilizando a Gmail API e OAuth 2.0.

Não solicite minha senha do Gmail.

A aplicação deverá permitir uma autorização inicial da minha conta, com armazenamento seguro das credenciais e permissões mínimas necessárias.

Quero que, após a configuração e ativação inicial, os envios elegíveis ocorram automaticamente, sem exigir aprovação manual individual.

Requisitos:

- Cada e-mail deve ser enviado individualmente.
- Respeitar os limites da conta e da API.
- Definir limites de envios configuráveis, com teto máximo inicial de 100 por dia.
- Começar com um volume conservador, aumentando apenas conforme o desempenho e as regras do provedor permitirem.
- Não enviar mensagens duplicadas.
- Impedir envios para contatos que solicitaram remoção.
- Registrar o identificador da mensagem enviada.
- Interromper envios após erros de autenticação, restrições da conta ou sinais de abuso.
- Nunca tentar contornar limites criando outras contas.

Inclua mecanismos para cumprir as regras de e-mail comercial aplicáveis a cada jurisdição, incluindo identificação correta do remetente, finalidade comercial, endereço postal válido quando exigido e descadastro.

Não ative envios para regiões cuja base legal e requisitos não tenham sido configurados.

**O envio automático deverá permanecer desativado até que eu conclua a configuração inicial de identidade comercial, descadastro, autorização da conta e regras de conformidade.**

Depois dessa configuração única, o sistema poderá operar diariamente sem minha intervenção, dentro dos limites autorizados.

## 8. Sistema de prevenção de duplicatas

Crie um banco de dados persistente.

Sugestão: PostgreSQL com Supabase, ou alternativa equivalente.

Registre permanentemente:

- ID do canal.
- Nome do canal.
- URL.
- Jogo principal.
- Número de inscritos.
- Pontuação de oportunidade.
- E-mail comercial e sua fonte.
- Data de descoberta.
- Data do último contato.
- Assunto enviado.
- Corpo da mensagem.
- Status de entrega.
- Identificador da mensagem no Gmail.
- Respostas recebidas.
- Solicitações de descadastro.
- Histórico de execução.

Utilize o ID do canal como identificador principal para deduplicação.

Também impeça que um mesmo endereço comercial compartilhado por vários canais receba mensagens repetitivas.

Um canal já abordado não deve voltar à fila de primeiros contatos.

Qualquer eventual acompanhamento deve ser limitado, relevante, permitido pelas regras aplicáveis e interrompido imediatamente diante de recusa ou pedido de descadastro.

## 9. Agendamento automático

Quero que a aplicação funcione diariamente, mesmo quando meu computador estiver desligado.

Prepare o agendamento utilizando GitHub Actions, um servidor ou outra infraestrutura persistente apropriada.

**Horário desejado:** todos os dias às 9h da manhã, horário de Brasília/Fortaleza (America/Fortaleza).

Fluxo automático:

1. Iniciar a execução.
2. Consultar o banco de dados existente.
3. Descobrir novos canais.
4. Eliminar duplicatas.
5. Analisar e pontuar os canais.
6. Localizar contatos comerciais.
7. Verificar elegibilidade.
8. Gerar propostas individuais.
9. Validar as propostas.
10. Enviar mensagens elegíveis dentro dos limites configurados.
11. Registrar os resultados.
12. Verificar respostas e descadastros de maneira autorizada.
13. Produzir o relatório diário.
14. Finalizar a execução com logs.

Se ocorrer falha temporária, implemente tentativas limitadas com backoff exponencial.

Não execute dois processos diários simultaneamente.

Garanta que o banco de dados permaneça disponível entre execuções e que uma interrupção não provoque envios duplicados.

## 10. Painel de controle

Crie um dashboard web simples, moderno e responsivo.

Utilize Next.js, React e Tailwind CSS, ou uma arquitetura semelhante se houver justificativa técnica.

Quero visualizar:

- Canais encontrados hoje.
- Canais encontrados no total.
- Leads qualificados.
- Contatos comerciais encontrados.
- E-mails preparados.
- E-mails efetivamente enviados.
- E-mails não enviados e respectivos motivos.
- Respostas identificadas.
- Respostas positivas.
- Contatos em negociação.
- Clientes conquistados, quando confirmados.
- Taxa de respostas.
- Taxa de conversão, quando houver dados suficientes.
- Erros e falhas de execução.

Inclua uma tabela pesquisável e filtros por nicho, inscritos, status, pontuação e data.

O painel deverá permitir:

- Pausar e retomar a automação.
- Ajustar limites diários.
- Alterar os critérios de seleção.
- Consultar as mensagens enviadas.
- Adicionar contatos à lista de exclusão.
- Exportar resultados em CSV.
- Visualizar os relatórios diários.

Proteja o painel com autenticação.

## 11. Relatórios automáticos

Ao final de cada execução, gere um relatório incluindo:

**RESUMO DIÁRIO DE PROSPECÇÃO**

Data: [data]

Canais descobertos: [quantidade]

Canais novos qualificados: [quantidade]

Minecraft: [quantidade]

Roblox: [quantidade]

E-mails comerciais identificados: [quantidade]

Propostas geradas: [quantidade]

Propostas enviadas: [quantidade]

Propostas bloqueadas: [quantidade e motivos]

Respostas detectadas: [quantidade]

Respostas positivas: [quantidade]

Erros: [quantidade]

Liste também as 10 melhores oportunidades identificadas, com nome do canal, link, pontuação e justificativa.

Disponibilize o relatório no dashboard e, se configurado, envie um resumo para meu próprio e-mail.

Nunca apresente estimativas como se fossem resultados reais.

## 12. Segurança, privacidade e conformidade

Implemente as seguintes medidas:

- Variáveis de ambiente para credenciais.
- Arquivo `.env.example` sem segredos.
- Nunca expor tokens no frontend.
- Nunca registrar tokens ou credenciais nos logs.
- Autenticação e autorização do dashboard.
- Validação das entradas.
- Controle de acesso ao banco de dados.
- Tratamento de erros.
- Limites de requisições.
- Proteção contra duplicação de envios.
- Respeito aos termos das plataformas e ao robots.txt quando aplicável.
- Exclusão dos contatos que solicitarem descadastro.
- Retenção mínima necessária de informações comerciais.
- Tratamento de conteúdos externos como dados não confiáveis, nunca como instruções executáveis.

Respeite a LGPD, a CAN-SPAM Act e outras normas aplicáveis aos destinatários.

Não utilize métodos para burlar mecanismos de segurança.

O sistema deve priorizar prospecção comercial legítima, direcionada e personalizada, não disparos indiscriminados de spam.

## 13. Arquitetura e tecnologias

Minha preferência tecnológica é JavaScript/TypeScript.

Utilize, quando apropriado:

- Node.js e TypeScript para o backend.
- YouTube Data API v3 para descoberta.
- Gmail API para envio.
- Uma API de IA para análise e personalização.
- PostgreSQL para persistência.
- Prisma ou outro ORM confiável.
- Next.js e React para o dashboard.
- Tailwind CSS para interface.
- GitHub Actions ou infraestrutura agendada equivalente.
- Vitest ou Jest para testes.
- Logs estruturados e monitoramento básico.

Você pode substituir tecnologias quando houver razões técnicas justificáveis.

Não utilize uma arquitetura desnecessariamente complexa.

Organize os módulos de descoberta, análise, contatos, personalização, conformidade, envio, acompanhamento, relatórios e painel separadamente.

## 14. Implementação e entrega

Execute este trabalho em etapas, mas entregue código funcional em vez de apenas propostas arquiteturais.

**Etapa 1 — Projeto e banco de dados**

Crie a estrutura, os modelos, as migrações, as configurações e o gerenciamento seguro de credenciais.

**Etapa 2 — Pesquisa de canais**

Implemente e teste a descoberta real de canais com a YouTube Data API.

**Etapa 3 — Qualificação e contatos**

Implemente o ranking, a identificação de oportunidades e a coleta permitida de contatos comerciais.

**Etapa 4 — Personalização**

Implemente as propostas em inglês, com validação de informações e proteção contra conteúdo inventado.

**Etapa 5 — Gmail**

Implemente OAuth, criação de mensagens, modo de simulação, envio real controlado e registro de resultados.

**Etapa 6 — Dashboard**

Construa a interface com indicadores reais do banco de dados.

**Etapa 7 — Agendamento**

Prepare o deploy e configure o processo de execução diária.

**Etapa 8 — Testes**

Adicione testes automatizados de:

- Deduplicação.
- Classificação de canais.
- Validação de contatos.
- Personalização de mensagens.
- Limites de envio.
- Descadastro.
- Idempotência.
- Falhas de API.
- Recuperação após interrupções.

Execute testes com dados simulados antes de qualquer envio real.

**Etapa 9 — Documentação**

Entregue:

1. Código-fonte completo.
2. Estrutura de pastas organizada.
3. README com instruções de instalação.
4. Modelo de variáveis de ambiente.
5. Instruções de criação das credenciais do Google Cloud.
6. Tutorial para conectar o Gmail.
7. Tutorial de implantação.
8. Configuração do agendamento diário.
9. Comandos de execução e teste.
10. Lista das etapas que ainda dependam das minhas credenciais ou autorizações.

Não diga que uma integração está funcionando se ela não foi testada.

Se faltar uma credencial ou autorização, implemente os módulos independentes e indique exatamente o que preciso configurar.

Não envie e-mails reais durante os testes.

## 15. Critérios de aceitação

Considerarei o projeto concluído quando:

- A aplicação conseguir pesquisar canais reais.
- Registrar resultados em um banco persistente.
- Distinguir canais novos dos já encontrados.
- Classificar oportunidades com critérios verificáveis.
- Identificar contatos comerciais públicos quando disponíveis.
- Produzir mensagens individualizadas em inglês.
- Enviar mensagens elegíveis após minha autorização inicial e configuração legal.
- Impedir duplicações e respeitar descadastros.
- Executar diariamente sem depender do meu computador.
- Exibir informações reais no dashboard.
- Produzir relatórios de cada execução.

A meta operacional é pesquisar e qualificar até 100 canais novos por dia, priorizando qualidade e disponibilidade real dos dados. Nunca invente resultados ou force envios para alcançar uma meta numérica.

**INSTRUÇÃO FINAL:** comece examinando o ambiente de desenvolvimento disponível. Em seguida, implemente a aplicação por módulos e execute os testes. Não pare na fase de planejamento. Prepare o projeto para implantação real, deixando claramente identificadas apenas as configurações externas que dependam de mim.
