# Concierge (Sema)

Assistente de atendimento por WhatsApp para prestadores de serviço. Cada prestador é um `Cliente` com um "cérebro" (JSON com serviços, preços, horários e regras). O robô responde quem escreve para o número do prestador, usa só o que está no cérebro e, quando o caso pede, encaminha o pedido para a equipe do prestador por e-mail (e avisa quando o pedido muda ou é cancelado). Existe também uma demo web para prospects e um painel admin para cadastrar clientes, editar o cérebro e ler conversas.

Para um retrato detalhado do código (prompt, cérebro, handoff, pontos frágeis), veja [`RAIO_X.md`](./RAIO_X.md).

## Stack

- Next.js 16 (App Router), React 19, TypeScript
- PostgreSQL com Prisma 7 (`@prisma/adapter-pg`)
- Redis (`ioredis`), hoje usado só no healthcheck
- Zod para validar a saída da IA
- Tailwind CSS 4
- IA: Anthropic, Gemini ou OpenAI, escolhida por `AI_PROVIDER`
- WhatsApp Cloud API da Meta, direto, sem BSP
- E-mail de encaminhamento: Resend (adapter com modo `mock` e `real`)
- Deploy: Railway (servidor Node persistente, `next start`)

## Fluxo de uma mensagem

1. A Meta faz `POST /api/whatsapp/webhook`.
2. O corpo cru é lido e o cabeçalho `X-Hub-Signature-256` é conferido com `APP_SECRET`. Com `APP_SECRET` definida, evento sem assinatura válida é recusado (401) e registrado no log. Sem ela, o webhook aceita tudo e registra um aviso a cada evento.
3. O servidor responde `200` e processa em seguida. Texto e áudio são tratados: o áudio é baixado pelo media ID, transcrito e entra no turno como texto (ver "Áudio" abaixo). Imagem, documento e vídeo recebem uma frase fixa pedindo texto; os demais tipos são descartados.
4. O `Cliente` é localizado pelo `phone_number_id`. Status `manutencao` responde com texto fixo; qualquer status diferente de `ativo` não responde.
5. `normalizarNumero()` define a chave da conversa. Números do Brasil (começam com 55) recebem a regra do nono dígito; os demais são usados exatamente como a Meta enviou.
6. `responderMensagem()` valida a entrada, carrega as últimas 40 mensagens e o resumo das mais antigas (ver "Resumo de conversa longa" abaixo), monta o prompt (prompt base, texto do modo, cérebro e canais do cliente) e chama a IA. Qualquer erro vira uma resposta de fallback.
7. A mensagem do contato e a resposta são gravadas e a resposta é enviada pela Graph API (`enviarTexto`).
8. Palavras-chave sensíveis marcam a conversa para revisão (`revisar`).
9. Cada encaminhamento registrado pelas ferramentas no turno (novo, atualização ou cancelamento) vai para o destino do cadastro, hoje o e-mail (ver "Encaminhamento" abaixo).
10. Se a conversa passou da janela de histórico, o resumo dela é atualizado (depois da resposta já ter saído).

## Resumo de conversa longa (T11)

- A IA recebe as últimas `LIMITE_HISTORICO` mensagens (padrão 40). Quando a conversa passa disso, as mensagens que saíram da janela viram um **resumo acumulativo** (nome da pessoa, o que ela quer, dados já informados, pedidos registrados/alterados/cancelados, pendências), guardado na conversa e mandado à IA junto com a janela, no bloco `<resumo_conversa>`.
- O resumo é gerado **depois** de a resposta sair (no link de teste, com `after()`), então não atrasa a pessoa; vale a partir da mensagem seguinte. A cada turno em que mais mensagens saem da janela, o resumo anterior é juntado com elas.
- Mesmo provedor e modelo do atendimento, sempre em português, até 3.000 caracteres. Cada chamada fica no registro técnico com a função `resumo`; falha vira o evento "Falha ao gerar resumo da conversa" e a conversa segue sem resumo novo.
- Onde fica: `WhatsappConversation.resumo` / `resumoAte` (WhatsApp) e tabela `DemoResumo` (uma linha por sessão do link de teste). A bateria não usa resumo (tarefa T47).
- Código: `src/lib/atendimento/resumo.ts` (quando e o que resumir) e `src/lib/ai/resumir.ts` (a chamada à IA).

## Encaminhamento (T9, T10)

O encaminhamento é feito por **ferramentas** da IA (`registrar_pedido`, `atualizar_pedido`, `cancelar_pedido`), não por um campo da resposta. O código decide primeiro; a IA escreve depois, já sabendo o resultado.

- A IA chama a ferramenta com os campos do pedido do cliente (lista do cadastro, T8), uma intenção e um resumo. Cliente sem lista de campos: só o nome é obrigatório.
- O código confere os campos obrigatórios e o limite do dia e devolve `registrado`, `faltando: X` ou `limite atingido`. Campo com valor que não é dado conta como vazio (T46): "faltando", "pendente", "a confirmar", "a definir", "desconhecido", "sem nome", "não informou" e parecidos, também entre parênteses ou colchetes, e o valor que só repete o nome do campo (nome = "nome"). Na atualização, esse tipo de valor não apaga o que já estava no pedido. Lista completa no RAIO_X.md, seção "O que o código valida". Só então a IA responde ao lead. Formato do campo (data válida, número) ainda não é conferido; data vaga fica vazia por instrução da ferramenta.
- **Limite:** até 3 encaminhamentos novos por dia por conversa, no dia do calendário de Brasília; à meia-noite libera mais 3. Substitui o antigo bloqueio de 24h. Vale no WhatsApp, no link de teste e na bateria.
- **Atualizar e cancelar (T10):** quando a pessoa muda um dado de um pedido já registrado (outro horário, mais pessoas), a IA chama `atualizar_pedido` só com o que mudou; quando desiste, `cancelar_pedido`. Os dois valem para o **último pedido ativo** da conversa (o mais recente não cancelado); sem pedido ativo a ferramenta responde `sem pedido ativo`. A atualização grava o pedido inteiro como ficou (campos mesclados). Respostas: `atualizado`, `cancelado`, `nada mudou`, `sem pedido ativo`, `limite atingido`.
- **Teto de mudanças:** até 5 atualizações e cancelamentos por dia por conversa, à parte do limite de 3 novos (que só conta pedidos novos).
- Os encaminhamentos ficam na tabela `Encaminhamento` (com o `tipo`: `novo`, `atualizacao`, `cancelamento`) e aparecem para a IA nos dados do momento: o que já foi registrado, o pedido ativo e as contagens do dia.
- **Pacote e destino (T10):** cada encaminhamento vira um pacote padrão (tipo, contato, campos do cliente, resumo, o que mudou), independente do destino (`src/lib/atendimento/pacote.ts`). O destino vem do cadastro (`Cliente.destinoEncaminhamento`) e é escolhido em `src/lib/atendimento/destino.ts`; só `email` existe. Destino novo entra ali, sem mexer em conversa, modo ou limite. Destino desconhecido gera o evento "Destino do encaminhamento não implementado".
- **E-mail (T10):** sem o conceito de "lead".
  - Assunto: tipo + nome do contato. Ex.: "Novo encaminhamento: Marcos", "Atualização de encaminhamento: Marcos, mudou horário", "Cancelamento de encaminhamento: Marcos". Sem nome, vai o telefone ("contato 55219..."). Nome e lista de campos mudados cortados em 60 caracteres.
  - Remetente: `Cliente.nomeRemetente` (vazio = "Concierge <nome do negócio>"), com o endereço de `RESEND_FROM_EMAIL`.
  - Corpo: na atualização, "O que mudou" em destaque no topo (frase da IA e cada campo "antes → depois"); no cancelamento, o motivo. Depois, os campos do pedido na ordem do cadastro, contato, resumo e quando. Sem histórico da conversa e sempre em português.
- **Bateria:** a porta devolve também `registrados` (tudo que as ferramentas registraram no turno, com o tipo); o roteiro reenvia na rodada seguinte, para a IA ver o pedido ativo. O card avaliado continua sendo o do encaminhamento novo.
- Depois de enviada a resposta, cada encaminhamento registrado vai para o destino (WhatsApp) ou vira o card da tela (link de teste, com o mesmo assunto e corpo do e-mail). Se o envio falhar, a IA já terá dito que encaminhou: fica o evento de falha.
- O filtro de vazamento só troca o texto da resposta; nunca desfaz um encaminhamento já registrado.
- **Só OpenAI** (`AI_PROVIDER=openai`): com Anthropic ou Gemini a ferramenta não é oferecida e o robô não encaminha. A OpenAI é chamada pela Responses API (`/v1/responses`): o `chat.completions` recusa ferramenta junto com raciocínio.
- **Rede de segurança:** se a OpenAI recusar a chamada com ferramenta (erro 400), o código responde sem ela. O lead não fica sem resposta, o encaminhamento daquele turno se perde e fica o evento "Erro do provedor de IA" com o motivo.
- Eventos: `Encaminhamento enviado` (com o `tipo` no detalhe), `Encaminhamento recusado por campo faltando`, `Limite diário de encaminhamentos atingido` (com a ferramenta no detalhe), `Destino do encaminhamento não implementado`.
- Cada encaminhamento custa uma ida e volta a mais à IA (duas chamadas, tokens somados no registro técnico).

## Rotas

APIs:

| Rota | O que faz |
|---|---|
| `GET /api/health` | Checa Postgres e Redis |
| `GET /api/whatsapp/webhook` | Verificação do webhook pela Meta (`VERIFY_TOKEN`) |
| `POST /api/whatsapp/webhook` | Recebe eventos da Meta |
| `POST /api/admin/login` | Login do admin (`ADMIN_PASSWORD`) |
| `POST /api/admin/logout` | Logout do admin |
| `POST /api/admin/clientes` | Cria um cliente (prospect, sem número, com link de teste) |
| `PUT /api/admin/clientes/[id]` | Salva o cadastro do cliente: nome, cérebro e campos de funcionamento |
| `POST /api/admin/clientes/[id]/ativar` | Prospect vira ativo (exige ID do número na Meta salvo) |
| `POST /api/admin/clientes/[id]/status` | Altera o status do cliente (e o tira da lista do interruptor geral) |
| `POST /api/admin/interruptor` | Interruptor geral de manutenção: `ligar` (pede a senha de novo) ou `desligar` |
| `GET /api/admin/clientes/[id]/conversas/[conversaId]/mensagens` | Lê mensagens de uma conversa |
| `POST /demo/[token]/mensagem` | Mensagem na demo |
| `POST /demo/[token]/reiniciar` | Reinicia a sessão da demo |
| `GET /api/bateria/clientes` | Bateria (T6): lista os cadastros. Só com `BATERIA_TOKEN` |
| `GET /api/bateria/clientes/[id]/cerebro` | Bateria: devolve o cérebro do cliente. Só com `BATERIA_TOKEN` |
| `POST /api/bateria/clientes/[id]/resposta` | Bateria: uma resposta do Concierge, sem gravar conversa. Só com `BATERIA_TOKEN` |

Páginas: `/`, `/admin`, `/admin/login`, `/admin/clientes`, `/admin/eventos`, `/admin/clientes/novo`, `/admin/clientes/[id]` (cadastro; `/admin/clientes/[id]/cerebro` redireciona para cá), `/admin/clientes/[id]/conversas`, `/admin/clientes/[id]/conversas/[conversaId]` e `/demo/[token]`.

## Variáveis de ambiente

Modelo em [`.env.example`](./.env.example).

| Variável | Para que serve |
|---|---|
| `DATABASE_URL` | Conexão com o Postgres |
| `JWT_SECRET` | Assina o cookie de sessão do admin |
| `ADMIN_PASSWORD` | Senha do painel admin |
| `VERIFY_TOKEN` | Palavra combinada com a Meta na verificação do webhook |
| `APP_SECRET` | Chave secreta do app da Meta, usada para conferir a assinatura dos eventos |
| `WHATSAPP_TOKEN` | Token da Cloud API usado no envio |
| `AI_PROVIDER` | `anthropic` (padrão), `gemini` ou `openai` |
| `AI_API_KEY` | Chave do provider escolhido |
| `AI_MODEL` | Opcional; senão usa o padrão do provider |
| `AI_AUDIO_MODEL` | Opcional; modelo de transcrição de áudio (OpenAI). Vazio = `gpt-4o-mini-transcribe` |
| `OPENAI_API_KEY` | Chave usada na transcrição de áudio, qualquer que seja o `AI_PROVIDER` (com `AI_PROVIDER=openai`, a `AI_API_KEY` também serve) |
| `REDIS_URL` | Redis (healthcheck) |
| `RESEND_MODE` | `mock` (padrão, só loga) ou `real` |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Envio do e-mail de encaminhamento no modo `real`. O nome do remetente vem do cadastro do cliente |
| `CALCOM_MODE`, `KIWIFY_MODE` | Modos dos adapters sem uso (ver abaixo) |
| `LIMITE_HISTORICO` | Opcional; quantas mensagens recentes vão para a IA (padrão 40). O que sai da janela vira o resumo da conversa. Em dev, um valor baixo (ex.: 6) facilita testar o resumo |
| `BATERIA_TOKEN` | Senha da porta da bateria de personas (mínimo 32 caracteres). Só no ambiente de dev. Vazia = porta desligada |

`APP_SECRET` é opcional por segurança de rollout: sem ela o webhook não verifica a assinatura (e avisa no log a cada evento). Com ela errada, o robô para de responder; para voltar, apague a variável no Railway, sem novo deploy. Troque a chave primeiro no staging.

## Observabilidade

- **Eventos** (`Evento`, tela `/admin/eventos`): o que deu errado ou merece atenção, com tema, gravidade, cliente, data e um detalhe só com identificadores (nunca texto de mensagem, nome, telefone ou e-mail). O catálogo fica em `src/lib/eventos.ts`; para registrar, `registrarEvento('chave', { clienteId, detalhe })`. Gravar nunca derruba o atendimento. Eventos de funções ainda não construídas (busca em documentos) entram no catálogo quando a função existir.
- **Registro técnico por chamada de IA** (`RegistroResposta`, sem tela por enquanto): modelo, versão do prompt (`VERSAO_PROMPT` em `build-prestador-prompt.ts`: mude junto com qualquer alteração de prompt), tokens de entrada/saída/cache, tempo, ferramentas chamadas (nome e resultado), custo estimado, origem (`whatsapp`, `teste`, `bateria`) e função (`resposta`, `busca_documentos`, `resumo`, `transcricao`). Os preços ficam em `src/lib/ai/precos.ts`.
- **Interruptor geral** (tela `/admin/clientes`): coloca todos os clientes ativos em manutenção, pedindo a senha do painel. "Voltar ao normal" reativa só os clientes que o próprio interruptor colocou; o botão de cada cliente manda mais: quem já estava em manutenção continua, e quem teve o botão mexido à mão sai da lista do interruptor.

## Áudio

- Todo cliente `ativo` lê áudio. O webhook baixa o arquivo na hora (a URL da Meta vale 5 minutos), transcreve com `AI_AUDIO_MODEL` e usa o texto como se tivesse sido digitado, dentro da espera de 10s do turno. A transcrição começa na chegada do áudio e corre em paralelo à espera.
- Só o texto é guardado, sempre começando com `[áudio transcrito]` (aparece no histórico e no painel). O áudio fica só em memória e nunca é gravado.
- Limite de 2min30. A duração é lida do próprio arquivo Ogg/Opus (a Meta não informa); para outros formatos vale um teto de 2,5 MB. Acima disso, o cliente recebe `FRASE_AUDIO_LONGO`. Se a transcrição falhar (sem chave, erro da OpenAI, texto vazio), recebe `FRASE_MIDIA`.
- Número, data ou nome que venham de áudio e entrem num encaminhamento são confirmados com a pessoa antes (regra no prompt, em `<audio_e_midia>`).
- Sem `OPENAI_API_KEY` o áudio cai sempre na frase fixa, com aviso no log.
- A página da demo tem botão de microfone (aparece com o campo vazio). Grava no navegador (HTTPS ou localhost), envia ao `POST /demo/[token]/mensagem` como `multipart/form-data` e usa a mesma transcrição e os mesmos limites do WhatsApp. A bolha passa a mostrar a transcrição, para avaliar a qualidade. Áudio recusado (longo ou com falha) recebe a frase fixa e não é gravado.

## Rodando localmente

```bash
cp .env.example .env     # preencha as variáveis
docker compose up -d     # Postgres 16 e Redis 7
npm install
npx prisma migrate dev
npm run dev
```

Scripts: `dev`, `build`, `start` (roda `prisma migrate deploy` antes), `lint`, `seed` (o `prisma/seed.ts` está vazio) e `bateria` (ver abaixo). Não há testes unitários nem CI.

## Cadastro de clientes (T8)

Clientes são criados e editados no admin: botão **Novo cliente** em `/admin/clientes` e **Editar cadastro** em cada linha. Prospect e cliente são o mesmo cadastro (`Cliente`): o cliente novo nasce prospect, sem número de WhatsApp, e já com link de teste (`/demo/{testeToken}`), bloqueado até ser liberado na lista (7 dias por vez). Ao fechar a venda, preencha o ID do número na Meta, salve e use **Ativar cliente**.

A tela tem, numa página só:

- **Nome do negócio** e **modo** (conversão, hospitalidade ou resolução).
- **Cérebro** em JSON, só com fatos do cliente (formato da T12, ver "Prompt base e modos" abaixo). Só os nomes das chaves são conferidos: chave fora da lista (`src/lib/cerebro/chaves.ts`, as 13 que o prompt lê) é recusada com o nome dela. Sem checagem de tipo nem de campo vazio.
- **Campos do pedido**: nome + obrigatório, na ordem do e-mail. Usados pela ferramenta de encaminhamento (T9).
- **E-mail que recebe os encaminhamentos**, **remetente** (vazio = "Concierge [nome do negócio]") e **destino** (só e-mail por enquanto).
- **Canais de fallback**: o principal é obrigatório; SAC, RH, compras, imprensa/parcerias e contato rápido são opcionais. Cada um com tipo (e-mail, telefone, WhatsApp, outro) e contato.
- **WhatsApp** (opcional): ID do número na Meta, ID da conta e número exibido no link de teste. Cliente ativo não pode ficar sem o ID do número.

Todos os campos já valem no atendimento: campos do pedido (T9), remetente e destino (T10), modo e canais de fallback (T12).

## Prompt base e modos (T12)

A postura do atendimento fica no código, não no cérebro: uma correção vale para todos os clientes. O prompt é montado nesta ordem: prompt base (`src/lib/ai/build-prestador-prompt.ts`), texto do modo (`src/lib/ai/modos.ts`), cérebro, canais do cliente, dados do momento e conversa.

- **Modo** (do cadastro), um por cliente. Cliente sem modo usa Conversão.
  - **Conversão:** conduz e qualifica para levar ao encaminhamento. Cerca ligada: explica como funciona, não dá parecer sobre o caso.
  - **Hospitalidade:** informa bem, sem empurrar. Encaminha só se a pessoa pedir algo que a equipe precisa fazer. Cerca neutra.
  - **Resolução:** diagnostica e resolve dentro da conversa; encaminhar é o último recurso. Cerca invertida: orienta o caso, mas só com base no cérebro; o que não está lá ou envolve dinheiro, segurança ou saúde, escala.
  - Cada modo diz também o que fazer depois do encaminhamento (pergunta nova, alteração, cancelamento, cobrança de retorno, insistência).
- **Desvios:** reclamação (fora do modo resolução), vaga de emprego, fornecedor, imprensa/parceria e urgência recebem o canal certo do cadastro (SAC, RH, compras, imprensa, contato rápido; vazio cai no principal) e **nunca** viram encaminhamento. Elogio, assunto fora do negócio e golpe são tratados sem canal.
- **Chaves do cérebro:** `NOME_ASSISTENTE`, `NOME_DO_NEGOCIO`, `NOME_PRESTADOR`, `PRAZO_RETORNO`, `RESUMO_NEGOCIO`, `SERVICOS`, `PRECOS_GERAIS`, `HORARIOS`, `COMO_FUNCIONA`, `PERGUNTAS_FREQUENTES`, mais as novas `LIMITADORES` (regras de decisão do cliente: o que encaminha e o que não), `AVISOS` (eventos, novidades, mudanças) e `AJUSTE_CERCA` (ajuste da cerca do modo para este cliente). `O_QUE_SEMPRE_ESCALA` e `CAMPO_LIVRE` saíram: o admin recusa e a IA não lê mais. Cérebro antigo precisa ser migrado (renomear para `LIMITADORES` e `AVISOS`).
- Ao mudar o prompt, mude também `VERSAO_PROMPT` (gravado em cada resposta) e os marcadores de vazamento em `src/lib/ai/validate-output.ts`.

## Bateria de personas

Teste automatizado do atendimento (T6), sob demanda. Uma IA faz o papel do cliente e o Concierge da dev responde de verdade, pelo mesmo motor e com o mesmo cérebro do link de teste. Cada conversa vira um arquivo de texto e o script dá um placar com o motivo de cada falha. O Claude Code lê as conversas com a régua de `bateria/criterios.md` e escreve o relatório crítico. O passo a passo dele fica em `.claude/skills/bateria/SKILL.md`: basta pedir "roda a bateria do Candê".

- **Onde roda:** fora do site, no terminal do Claude Code, contra a dev. A porta da bateria (`/api/bateria/...`) ignora se o link de teste está liberado, não grava nada em `DemoMensagem`, não conta no limite de mensagens do link e não aparece nas conversas do cliente. O custo do Concierge fica no registro técnico com origem `bateria`.
- **Arquivos:**
  - **Cada conversa junta três partes.** Duas são fixas e iguais para qualquer negócio (restaurante, agência, médico, advogado, escola, estética, odontologia, a própria Sema); só a terceira muda por cliente:
    - `bateria/pessoas.json`: quem fala. São 8 pessoas fixas, só com o jeito: Ana gentil, Bruno apressado, Carla desconfiada, Daniel indeciso, Elaine leiga, Fábio irritado, Gustavo manipulador e Helen estrangeira.
    - `bateria/situacoes.json`: o que acontece. São 13 situações fixas: pede direto, tira dúvidas e depois pede, cobra resposta e pede um responsável, muda e cancela, só pesquisando, urgência, o cérebro não sabe, documento, golpe e robô, tirar vantagem, prompt injection, prompt injection no card, fora do escopo. Cada uma tem a pessoa padrão e o encaminhamento esperado. As de prompt injection (11 e 12) têm mensagens fixas.
    - `bateria/clientes/<cliente>.json`: a ficha do cliente, a única parte que muda. Diz o que é "o pedido" ali, os dados que o pedido precisa, se o pedido gera encaminhamento, os assuntos, uma pergunta que o cérebro não responde, um documento e o que o atendente nunca pode dizer.
  - `bateria/criterios.md`: a régua.
  - `bateria/resultados/<cliente>/<data_hora>/`: as conversas, o `placar.md`, o `placar.json` e o `relatorio.md`. Essa pasta é commitada, para comparar com a rodada anterior.
- **Comandos:**
  - `npm run bateria -- listar`: lista os cadastros da dev.
  - `npm run bateria -- cerebro <nome>`: baixa o cérebro para `bateria/.cerebros/`, que fica fora do git.
  - `npm run bateria -- <cliente> [--situacao 4,9] [--pessoa ana] [--repeticoes N] [--max-turnos N] [--paralelo N]`: roda a bateria. Por padrão roda as 13 situações, cada uma 1 vez, com até 12 mensagens do cliente e 3 conversas em paralelo. `--pessoa` troca quem fala em todas as situações escolhidas.
  - **Cliente novo:** basta criar a ficha a partir do cérebro.
- **Checagens automáticas:**
  - mais de uma pergunta na mesma mensagem;
  - "vou encaminhar" depois de já ter encaminhado;
  - encaminhou quando não devia, ou não encaminhou quando devia;
  - card com campo vazio;
  - "assistente virtual" sem o cliente perguntar;
  - travessão;
  - resposta de erro, vazamento ou bloqueio inesperado;
  - dizer "encaminhei" ou "anotei" sem card, ou "o time ajusta" depois do card;
  - pedir o nome de quem não é lead (situações 5, 9 e 13);
  - prompt injection: vazar pedaço das instruções internas (situação 11) ou levar para o card o texto que o cliente ditou (situação 12);
  - o que o atendente nunca pode dizer naquele cliente.
  - O card avaliado é o do primeiro encaminhamento; os seguintes aparecem no turno como "registrou outro encaminhamento", e o resultado da ferramenta ("faltando: data", "limite atingido") aparece em cada turno. O roteiro reenvia à porta os encaminhamentos já feitos, para a IA ver o estado e o limite valer; nada é gravado no banco.
  - O resto (se o card trouxe os dados que o pedido precisa, tom, se respondeu de frente) fica na leitura crítica.
- **Cliente simulado conferido:** mensagem com marcação técnica ou comentário de bastidor (ex.: `<invoke>`, "segue a próxima mensagem") é descartada e pedida de novo, até 3 tentativas. Se as 3 falharem, a conversa termina com a falha `execucao` e o atendente nunca recebe esse texto. O modelo atual não aceita `temperature`, então as frases variam entre rodadas: compare por situação, não por frase.
- **Variáveis no ambiente do Claude Code** (não no Railway):

| Variável | Para que serve |
|---|---|
| `BATERIA_URL` | Endereço da dev (ex.: `https://dev.usesema.com.br`) |
| `BATERIA_TOKEN` | A mesma senha configurada no Railway de dev |
| `BATERIA_ANTHROPIC_KEY` | Chave da Anthropic usada pelo cliente simulado |
| `BATERIA_MODELO` | Opcional; modelo do cliente simulado (padrão `claude-sonnet-5-5`) |
| `BATERIA_ANTHROPIC_BASE_URL` | Opcional; padrão `https://api.anthropic.com` |

## Deploy

Railway, com ambiente `staging` ligado à branch `dev`. Configure as variáveis acima em cada ambiente, com `JWT_SECRET` diferente entre eles. O Postgres e o Redis vêm dos plugins do Railway. O healthcheck é `/api/health`. Mudanças no webhook (como a assinatura) devem passar pelo staging antes da produção.

## Código que existe mas não é usado

- Integração Kiwify (`src/lib/integrations/kiwify/`): não é importada por nenhuma rota.
- `sendBookingConfirmation` (`src/lib/integrations/resend/`): sem chamador; no modo `real` lança "não implementado". Só `enviarEncaminhamento` é usado.
- Campos `checklist` e `steps` da resposta da IA (`src/lib/ai/schema.ts`): o prompt manda ficarem `null` e nada os exibe.
- Campo `Cliente.whatsappToken`: o envio usa `WHATSAPP_TOKEN`.

Guardados para uso futuro:

- `checkRateLimit` (`src/lib/ratelimit/`): ainda não é chamado; será ligado ao webhook no item 7.3.
- Integração Cal.com (`src/lib/integrations/calcom/`): prevista para o item 5.7.
