# T00 — Reconhecimento técnico · Lead Recovery

Tarefa exclusivamente de investigação. Nenhum código, migração, configuração ou dado foi alterado; este arquivo é a única mudança.

- **Base analisada:** branch `dev`, commit `deae70a` ("Add read-only lead recovery classification pilot (#68)"), em 2026-11-04.
- **Idioma/convenção:** português, como o restante do repositório.

## Legenda

Cada afirmação relevante carrega uma etiqueta:

| Etiqueta | Significado |
|---|---|
| **[CONFIRMADO]** | Lido diretamente no código ou executado nesta investigação. Vem com arquivo/função. |
| **[HIPÓTESE]** | Inferência a partir do código ou conhecimento externo (Meta, Railway) que **não** foi comprovada aqui. |
| **[VERIFICAR NO AMBIENTE]** | Depende de configuração do Railway/Meta/painel que não aparece no repositório. |
| **[RECOMENDAÇÃO]** | Opinião para orientar a T01; não é fato. |

Referências de linha valem para o commit `deae70a`; onde não há linha, a função é o ponto de referência.

---

## 1. Resumo executivo

**Viabilidade: alta.** O Lead Recovery cabe na arquitetura atual sem tocar no motor de atendimento. Quase tudo de que ele precisa já existe (conversas, mensagens, encaminhamentos, eventos, registro de IA, Anthropic SDK, Redis, Postgres, envio pela Cloud API). O que falta é **pequeno em volume, mas crítico em segurança**: estado de tentativas, configuração por cliente, envio de template, rastreio de entrega, agendador e salvaguardas contra disparo indevido.

### Principais descobertas

1. **Já existe um piloto de classificação** (`recuperacao/`, PR #68): worker de execução única, somente leitura, sem envio, que recorta a conversa em "24h de silêncio" e classifica com IA (`recuperar` / `nao_recuperar` / `incerto`). Pode virar a base do passo 3–4 do fluxo, mas **não é o módulo de produção** (ver seção 5 e 6). **[CONFIRMADO]**
2. **Não existe nenhum suporte a templates** da Meta. `enviarTexto` envia `type: 'text'` fixo, devolve `void` e **engole respostas HTTP de erro** (só log + evento). **[CONFIRMADO]** `src/lib/whatsapp/send.ts`
3. **O webhook ignora tudo que não é `messages`** — incluindo `statuses` (entregue/lido/falha). Hoje não há como saber se uma mensagem foi entregue, nem guardar o `wamid` de saída. **[CONFIRMADO]** `route.ts` `processar()` (l. 121–138), `send.ts`
4. **O histórico não prova entrega.** A resposta do Concierge é gravada em `WhatsappMessage` **antes** do envio (`route.ts` l. 361–370) e o envio não lança em erro HTTP. "Última mensagem ASSISTANT" ≠ "o lead recebeu". **[CONFIRMADO]**
5. **O timestamp de uma mensagem do lead no banco é o do fechamento do turno**, não o da chegada: `salvarMensagem(USER)` roda depois da espera de 10 s + latência da IA. Mensagens só de mídia, figurinhas e turnos perdidos em reinício **nem chegam a ser gravadas**. "Última atividade do lead" calculada do banco pode estar errada para menos. **[CONFIRMADO]** `route.ts` l. 315–362, `turno.ts`
6. **Não há campo de opt-out/consentimento/bloqueio** em nenhum modelo, nem tratamento de "pare / não quero mais" fora do que a IA decide no prompt. **[CONFIRMADO]** `prisma/schema.prisma`
7. **A origem do anúncio não é persistida.** `origemAnuncio` é um booleano em memória (`message.referral != null`); as colunas `ctwaClid`/`referral`/`referralEm` (T50) existem, mas **nenhum código grava nelas**. **[CONFIRMADO]** `grep` em `src/` + `route.ts` l. 156
8. **Não há agendador, fila ou worker contínuo.** O único "processamento assíncrono" é `setTimeout` em processo (debounce do turno, `turno.ts`) mais fire-and-forget depois do HTTP 200. Reinício perde trabalho. **[CONFIRMADO]**
9. **Configuração por cliente é viável e natural**: `Cliente` já concentra cadastro de funcionamento (T8) e todo dado é filtrado por `clienteId`. Nada hoje existe para "recuperação". **[CONFIRMADO]**
10. **Token do WhatsApp é global (`WHATSAPP_TOKEN`)**; `Cliente.whatsappToken` e `wabaId` existem no schema mas **não são usados no envio**. Bloqueia a oferta a outros clientes com WABAs diferentes. **[CONFIRMADO]**
11. **Staging ↔ branch `dev`, produção ↔ `main`** estão documentados no README, mas **nada do Railway está no repositório** (sem `railway.json`, `nixpacks.toml`, `Procfile`, `.github`). Tudo sobre Railway é **[VERIFICAR NO AMBIENTE]**.
12. **`npm start` executa `prisma migrate deploy` a cada boot**, em qualquer ambiente. Migração mergeada em `main` é aplicada automaticamente no próximo deploy de produção, sem passo manual de aprovação. **[CONFIRMADO]** `package.json`

### Riscos que mais pesam (detalhe na seção 7)

- Disparo em massa no backlog ao ligar o recurso (conversas antigas).
- Duplicidade/corrida entre worker, retorno do lead e Concierge (sem lock por conversa).
- Envio sem registro correspondente no histórico (e vice-versa).
- Política da Meta (opt-in, categoria Marketing, limite por usuário) — **[HIPÓTESE]** a validar antes de qualquer envio real.

---

## 2. Arquitetura atual

### 2.1 Stack e padrões — **[CONFIRMADO]**

| Item | Fato | Fonte |
|---|---|---|
| Framework | Next.js 16.2.7 (App Router), React 19.2.4, TypeScript estrito | `package.json`, `tsconfig.json` |
| Servidor | Processo Node **persistente** (`next start`), não serverless | README l. 17; `package.json` `start` |
| Banco | PostgreSQL via Prisma 7.8 com `@prisma/adapter-pg`; client gerado em `src/generated/prisma` (git-ignorado) | `prisma/schema.prisma`, `src/lib/prisma.ts`, `prisma.config.ts` |
| Redis | `ioredis` 5; timeouts curtos (1,5 s); usado em dedupe e buffer de turno | `src/lib/ratelimit/redis.ts`, `src/lib/whatsapp/turno.ts` |
| IA | Anthropic (padrão `claude-haiku-4-5`), Gemini, OpenAI selecionáveis por `AI_PROVIDER`; ferramentas (tools) **só na OpenAI** | `src/lib/ai/config.ts`, `src/lib/ai/index.ts` |
| Validação | Zod 4 | `package.json` |
| Testes | `tsx --test` só para `recuperacao/`; bateria de personas (manual); sem CI | `package.json`, `.github` ausente |
| Logs | JSON em produção (`src/lib/logger.ts`); eventos operacionais na tabela `Evento` | `src/lib/logger.ts`, `src/lib/eventos.ts` |
| Padrão de nomes | Domínio em português (`Cliente`, `Encaminhamento`, `registrarEvento`) | — |
| Padrão de "portas" | Motor compartilhado (`responderMensagem`) + uma porta por canal (webhook WhatsApp, demo, bateria) | `src/lib/atendimento/motor.ts` |

`npx tsc --noEmit` na base atual: **sem erros**. `npm run test:recuperacao`: **5/5 passam**. (Executados nesta investigação, sem efeito colateral.)

### 2.2 Organização do projeto — **[CONFIRMADO]**

```
src/app/api/whatsapp/webhook/route.ts   ← porta WhatsApp (GET verificação, POST eventos)
src/app/api/{admin,bateria,health}/     ← admin, bateria de personas, healthcheck
src/app/admin/…                          ← painel (senha única)
src/app/demo/[token]/…                   ← link de teste (sem WhatsApp)
src/lib/atendimento/                     ← motor, encaminhamento, pacote, destino, resumo
src/lib/whatsapp/                        ← send, phone, conversa, turno, audio, midia, assinatura
src/lib/ai/                              ← provedores, prompt, filtros, registro, preços
src/lib/{eventos,logger,prisma}.ts
src/lib/ratelimit/redis.ts               ← cliente Redis
src/lib/documentos/                      ← PDFs do cliente (T14)
prisma/schema.prisma + migrations/       ← 16 migrações, todas aditivas
recuperacao/                             ← piloto de classificação (somente leitura)
bateria/                                 ← teste de personas
```

### 2.3 Prisma e PostgreSQL — **[CONFIRMADO]**

- `datasource db { provider = "postgresql" }` sem `url` no schema; a URL vem de `DATABASE_URL` via `prisma.config.ts` (Prisma 7).
- Modelos relevantes: `Cliente`, `WhatsappConversation`, `WhatsappMessage`, `Encaminhamento`, `Evento`, `RegistroResposta`, `InterruptorGeral` (detalhe na seção 3.3).
- `MessageRole` = `USER | ASSISTANT`. **Não há campo de origem/tipo da mensagem** (ex.: "resposta do Concierge" × "mensagem de recuperação" × "documento").
- `WhatsappMessage` tem **um único índice**: `@@index([conversationId])`. Não há índice por `(role, createdAt)` nem `(conversationId, createdAt)`.
- Migrações: `prisma migrate deploy` roda dentro de `npm start` (`package.json`). Histórico de 16 migrações, todas "só acrescenta"; a mais destrutiva (`unificar_demo_cliente`) copia dados e **mantém** a tabela antiga.

### 2.4 Redis — **[CONFIRMADO]**

| Chave | Uso | TTL | Arquivo |
|---|---|---|---|
| `wa:dedupe:{wamid}` | `SET NX` — descarta reentrega da Meta | 7 dias | `turno.ts` `registrarSeNova` |
| `wa:buf:{phoneNumberId}:{from}` | buffer de mensagens do turno | 1 h | `turno.ts` `adicionarAoTurno` |
| `wa:seq:{phoneNumberId}:{from}` | contador que identifica o timer "vencedor" | 1 h | idem |
| (rate limit) | `checkRateLimit` **não é chamado** em nenhuma rota ativa | — | `src/lib/ratelimit/index.ts` (código morto segundo `RAIO_X.md` §10) |

Se o Redis cai: modo degradado (mensagem respondida na hora, **sem dedupe**, sem junção). `/api/health` devolve 503 se Redis ou DB falham.

### 2.5 Agendamento, filas e processamento assíncrono — **[CONFIRMADO]**

- **Não há** cron, fila (BullMQ etc.), `node-cron`, `instrumentation.ts` (removido na T7) nem worker contínuo.
- O que existe:
  - `setTimeout` por mensagem recebida para fechar o turno (`turno.ts` l. 368); o timer vive na memória do processo. "Reinício do servidor no meio da espera perde o turno (risco aceito)" — está no comentário do arquivo.
  - `processar(body).catch(...)` depois de responder 200 ao webhook (`route.ts` l. 111–118) — fire-and-forget.
  - `after()` do Next só na demo (`demo/[token]/mensagem/route.ts` l. 205).
  - O resumo (`atualizarResumoWhatsapp`) roda **em linha**, ao fim do `tratarTurno`.
- O piloto `recuperacao/` roda como **processo à parte, com início e fim** (`npm run recuperacao`).

### 2.6 Ambientes staging/produção — o que está no repositório

**[CONFIRMADO]** (documentado em texto, não em configuração):
- README "Deploy": "Railway, com ambiente `staging` ligado à branch `dev`." `RAIO_X.md` l. 13: `staging` (branch `dev`) e `production` (branch `main`), Nixpacks, sem Dockerfile.
- Postgres e Redis são "plugins do Railway" por ambiente; `JWT_SECRET` deve diferir entre ambientes.
- Healthcheck: `/api/health`.
- `BATERIA_URL` de exemplo: `https://dev.usesema.com.br` (README).
- O piloto de recuperação exige `RAILWAY_ENVIRONMENT_NAME=staging` para ler o banco (`recuperacao/rodar.ts`).

**[VERIFICAR NO AMBIENTE]** — nada abaixo é comprovável pelo repositório:
- Se staging e produção realmente têm Postgres/Redis **separados** e URLs distintas.
- Se existe número de WhatsApp/WABA de teste ligado ao staging, ou se o staging recebe webhook da Meta de algum app.
- Quantas réplicas/instâncias cada serviço roda (o debounce em memória só é correto com **1** instância).
- Se há auto-deploy ao dar push em `dev`/`main`.
- Se o plano do Railway permite serviços com cron e volume.
- Variáveis realmente definidas (`WHATSAPP_TOKEN`, `APP_SECRET`, `AI_PROVIDER`, `RESEND_MODE`, etc.). O README avisa que `RESEND_MODE` padrão é `mock`.

### 2.7 Tarefas periódicas no Railway

- **[CONFIRMADO]** O repositório não define nenhuma. O piloto propõe (README de `recuperacao/`, seção "Serviço Railway proposto") um **serviço separado, restart policy NEVER, sem cron**, rodando um comando que termina.
- **[HIPÓTESE]** O Railway oferece "Cron Schedule" por serviço (o processo precisa terminar; intervalo mínimo na casa de poucos minutos). Alternativas: loop dentro de um serviço "worker" dedicado, ou `setInterval` dentro do serviço web.
- **[VERIFICAR NO AMBIENTE]** Disponibilidade e limites do cron no plano atual; quantas réplicas do web.
- **[RECOMENDAÇÃO]** Evitar `setInterval` no serviço web (dobra a execução com 2 réplicas, morre a cada deploy, e acopla o recovery ao atendimento). Preferir serviço separado + trava no banco (seção 9).

---

## 3. Fluxos existentes

### 3.1 Recebimento (webhook → persistência)

Arquivo: `src/app/api/whatsapp/webhook/route.ts`.

| Etapa | O que acontece | Fonte |
|---|---|---|
| Verificação | `GET` com `hub.verify_token` == `VERIFY_TOKEN` | l. 45–58 |
| Assinatura | `X-Hub-Signature-256` (HMAC-SHA256 do corpo cru) conferida com `APP_SECRET`; **sem a variável, aceita tudo** e só avisa no log. 401 + evento (no máx. 1/min) se inválida | l. 85–102; `assinatura.ts` |
| Resposta | **200 imediato**; o processamento segue em background (`processar(body).catch`) | l. 111–118 |
| Filtro | Só `change.field === 'messages'` e só `value.messages`. **`value.statuses` é ignorado** | l. 121–138 |
| Tipos aceitos | `text`, `audio`, `image`, `document`, `video`. Qualquer outro (`sticker`, `reaction`, `location`, `button`, `interactive`…) é **descartado em silêncio** | l. 150–154 |
| Identificação do cliente | `prisma.cliente.findUnique({ where: { phoneNumberId } })` (campo `@unique`). Não achou → evento `cliente_nao_encontrado`. `status` precisa ser `ativo` ou `manutencao` | l. 183–198 |
| Identificação do contato | `message.from` → `normalizarNumero()` → `numeroContato`; chave única `(clienteId, numeroContato)` | `phone.ts`, `conversa.ts` |
| Normalização | Só números `55…`: 12 dígitos com local iniciando em 6–9 ganha o nono dígito. Demais: só dígitos | `phone.ts` |
| Duplicidade | `registrarSeNova(wamid)` no Redis (7 dias). **Não há `wamid` em nenhuma tabela** | l. 172; `turno.ts` |
| Origem de anúncio | `origemAnuncio = message.referral != null` — vai no `ItemTurno`, gera o evento `mensagem_de_anuncio` e a instrução `<origem_anuncio>` do prompt (só quando `ehPrimeiraMensagem`). **Nada é gravado** | l. 156, 200–206; `motor.ts` l. 46–47, 158 |
| Agrupamento | Cada mensagem entra no buffer Redis e reinicia um timer de 10 s (`WHATSAPP_DEBOUNCE_MS`); o timer da última fecha o turno e chama `tratarTurno` com todos os itens | `turno.ts` |
| Lida/digitando | `marcarComoLidaEDigitando` (fire-and-forget) | `send.ts` l. 79–117 |
| Conversa | Criada **só em `tratarTurno`**, depois da espera (`acharOuCriarConversa`, com tratamento de `P2002`) | `conversa.ts` |
| Persistência | Depois da resposta da IA: `salvarMensagem(USER, texto)` e `salvarMensagem(ASSISTANT, mensagem)`; cada uma também faz `update updatedAt` na conversa | `route.ts` l. 361–362; `conversa.ts` |
| Só mídia | Responde `FRASE_MIDIA` **sem criar conversa nem gravar nada** | l. 315–324 |

**Horários e metadados gravados:** apenas `createdAt` (momento do `INSERT`). O campo `timestamp` da Meta, o `context` (resposta a mensagem anterior), `wamid`, `profile.name` e o `type` original **não são lidos nem guardados**. **[CONFIRMADO]**

**Comportamento diante de falhas:**
- Erro em `processar` → log + evento `webhook_erro_geral`; **a Meta já recebeu 200**, então não reenvia. **[CONFIRMADO]**
- Reinício durante a espera do turno, ou durante a chamada à IA → mensagem perdida, sem rastro. **[CONFIRMADO]** (comentário de `turno.ts`, `RAIO_X.md` §10.3)
- Redis fora → sem dedupe nem junção, resposta imediata. **[CONFIRMADO]**
- IA falha → `FALLBACK_RESPONSE` ("Tive um problema técnico…") **é gravado como fala do assistente e enviado**. **[CONFIRMADO]** `motor.ts` l. 194–199

### 3.2 Geração de resposta e envio

`tratarTurno` → `responderMensagem` (`motor.ts` l. 85–210): filtro de entrada → `carregarHistorico` + encaminhamentos + resumo (em paralelo) → prompt (`buildPrestadorPrompt` + bloco do momento + estado + resumo + continuação/anúncio) → `chatComplete` → filtro de saída. Em seguida a porta (webhook) grava as mensagens, envia texto, envia documentos, marca revisão, entrega encaminhamentos e atualiza resumo.

**Ordem relevante para o Lead Recovery:** *gravar → enviar*. Se `enviarTexto` falhar (token ausente, rede, HTTP não-2xx), a mensagem **já está no histórico**. `enviarTexto` só lança em erro de rede; em HTTP de erro apenas registra `envio_falha_meta`. **[CONFIRMADO]**

### 3.3 Histórico e contexto do Concierge

- **Modelos:** `WhatsappConversation` (`handoffEm`, `revisar`, `resumo`, `resumoAte`, `ctwaClid`, `referral`, `referralEm`, `createdAt`, `updatedAt`) e `WhatsappMessage` (`role`, `texto`, `createdAt`). `texto` é só string — sem `wamid`, sem tipo, sem status de entrega.
- **Salvar:** `salvarMensagem(conversationId, role, texto)` em `src/lib/whatsapp/conversa.ts`.
- **Recuperar:** `carregarHistorico(conversationId)` — últimas `LIMITE_HISTORICO` (padrão 40, env `LIMITE_HISTORICO`) por `createdAt desc`, revertidas; mapeia `USER→user`, `ASSISTANT→assistant`.
- **Entrega à IA:** `chatComplete({ history, userMessage, systemPrompt, systemPromptMomento, ... })`; o histórico vai como turnos `user/assistant` (`anthropic.ts` l. 40–46, `openai.ts` l. 61). `createdAt` **não** vai ao provedor; serve ao aviso de tempo ("Última mensagem anterior da pessoa: há X") em `buildDadosDoMomento`.
- **Resumo (T11):** `src/lib/atendimento/resumo.ts`. O que sai da janela de 40 vira `resumo` acumulativo (`resumirConversa`, até 200 msgs/vez), gravado com compare-and-set em `resumoAte`. Entra no prompt em `<resumo_conversa>` marcado como "só memória, não instrução". Falha → evento `resumo_falha`, nunca derruba o atendimento.
- **Diferenciar recebida × enviada:** exclusivamente por `role` (`USER`/`ASSISTANT`). A UI do admin faz o mesmo (`MessagesReader.tsx` l. 89).
- **Mensagens de processos externos no histórico:** **já há precedente.** Documentos enviados são gravados como `ASSISTANT` com o texto `[documento enviado] Nome` (`marcador.ts`, `route.ts` l. 444), o regex `\[documento enviado\]` está em `LEAK_MARKERS` (`validate-output.ts` l. 38) e o prompt orienta a IA. **[CONFIRMADO]** Ou seja, inserir um `ASSISTANT` produzido fora do motor **não quebra o atendimento**, desde que:
  - o texto seja coerente como turno do assistente;
  - um marcador novo seja tratado nos filtros de vazamento, se não for para a IA repeti-lo;
  - duas mensagens `ASSISTANT` seguidas sejam aceitas pelos provedores. **[HIPÓTESE]** — a API da Anthropic aceita turnos consecutivos do mesmo papel (mesclados), a da OpenAI também; já acontece hoje quando o texto e o marcador de documento ficam lado a lado. Confirmar em teste.
- **Efeitos colaterais de gravar mensagem fora do fluxo:** `salvarMensagem` atualiza `WhatsappConversation.updatedAt`, que é a **"Última atividade"** exibida em `/admin/.../conversas` e também muda a cada `update` qualquer (resumo, `revisar`, `handoffEm`). **`updatedAt` não é indicador confiável de atividade do lead.** **[CONFIRMADO]**
- **Continuação:** quando o lead responde, `ehPrimeiraMensagem = count(mensagens)===0` é falso → o prompt inclui `INSTRUCAO_CONTINUACAO` e o histórico traz a mensagem de recuperação (se estiver gravada). Se **não** estiver gravada, o Concierge não saberá da tentativa. **[CONFIRMADO]**

### 3.4 Envio — WhatsApp Cloud API

`src/lib/whatsapp/send.ts` (Graph API **v21.0 hardcoded** em 4 pontos + `midia.ts`):

| Função | Faz | Retorno | Erros |
|---|---|---|---|
| `enviarTexto` | `POST /{phoneNumberId}/messages`, `type:'text'` | `void` | sem token: evento `envio_sem_token`; rede: evento + **lança**; HTTP ≠ 2xx: log + evento `envio_falha_meta` (com `status` e `codigoMeta`) e **segue sem lançar** |
| `enviarDocumento` | upload `/media` + mensagem `type:'document'` | `boolean` | nunca lança; evento `documento_falha_envio` |
| `marcarComoLidaEDigitando` | `status:'read'` + `typing_indicator` | `void` | nunca lança |
| `baixarMidia` (`midia.ts`) | baixa mídia recebida | — | lança se sem token |

- **Identificadores da Meta:** o corpo da resposta de sucesso (`messages[0].id`) **não é lido**. Nenhum `wamid` de saída é persistido. **[CONFIRMADO]**
- **Webhooks de status:** não processados (seção 3.1). **[CONFIRMADO]**
- **Templates:** nenhuma ocorrência de `template`/`type: 'template'`/API de templates no código. **[CONFIRMADO]** (`grep` em `src/`)
- **Token:** sempre `process.env.WHATSAPP_TOKEN`; `Cliente.whatsappToken` e `wabaId` são só cadastro (CadastroForm/`cadastro.ts`). **[CONFIRMADO]**
- **Reutilizável:** `normalizarNumero`, `codigoDoErroMeta` (privado, precisa exportar), padrão de eventos, estrutura `fetch` + headers. **Não reutilizável tal como está:** `enviarTexto` (sem retorno útil, sem template, engole HTTP de erro).

---

## 4. Mapa de arquivos

| Caminho | Responsabilidade | Relevância para o Recovery |
|---|---|---|
| `prisma/schema.prisma` | Todos os modelos | Onde entram estado de tentativas e configuração |
| `prisma/migrations/*` | 16 migrações aditivas | Padrão para a nova |
| `package.json` | Scripts (`start` roda `migrate deploy`) | Como a migração chega à produção |
| `src/app/api/whatsapp/webhook/route.ts` | Porta WhatsApp inteira | Pontos de integração: ignorar `statuses`, tipos `button`, não gravar `referral`, ordem gravar→enviar |
| `src/lib/whatsapp/turno.ts` | Dedupe + buffer + debounce (Redis + timer) | Janela de corrida; reinício perde turno |
| `src/lib/whatsapp/conversa.ts` | `acharOuCriarConversa`, `carregarHistorico`, `salvarMensagem` | Gravar marcador/tentativa no histórico |
| `src/lib/whatsapp/phone.ts` | `normalizarNumero` | Mesmo número no envio de template |
| `src/lib/whatsapp/send.ts` | Envio texto/documento/lida | Base para `enviarTemplate` |
| `src/lib/whatsapp/assinatura.ts` | HMAC do webhook | Reutilizável para simular webhooks em staging |
| `src/lib/whatsapp/audio.ts`, `midia.ts`, `audio-duracao.ts` | Áudio/mídia recebidos | Mídia não é gravada (afeta "última atividade") |
| `src/lib/atendimento/motor.ts` | `responderMensagem`, instruções de continuação/anúncio, ferramentas | **Não deve ser alterado**; só lê histórico |
| `src/lib/atendimento/encaminhamento.ts`, `pacote.ts`, `destino.ts` | Registrar/atualizar/cancelar pedido, e-mail ao prestador | `Encaminhamento` existente = lead já qualificado → excluir da recuperação |
| `src/lib/atendimento/resumo.ts` | Resumo acumulativo | Conversas longas; compare-and-set como modelo |
| `src/lib/ai/*` | Provedores, prompt, filtros, registro, preços | `registrarResposta` e `ContextoRegistro` (`Origem`, `Funcao` são uniões TS, sem enum de banco) |
| `src/lib/ai/validate-output.ts` | `LEAK_MARKERS` | Se houver marcador novo no histórico |
| `src/lib/eventos.ts` | Catálogo de eventos (`Tema` é união TS; `TEMAS` alimenta o filtro do admin) | Novos eventos/tema sem migração |
| `src/lib/prisma.ts` | Client Prisma singleton | Reutilizável por um worker |
| `src/lib/ratelimit/redis.ts` | `getRedis()` | Locks/contadores |
| `src/lib/admin/cadastro.ts`, `src/app/admin/clientes/CadastroForm.tsx`, `src/app/api/admin/clientes/[id]/route.ts` | Cadastro do cliente (Zod + formulário + PUT) | Onde a configuração por cliente seria editada |
| `src/lib/admin/interruptor.ts` | Interruptor geral de manutenção | Kill-switch existente (status `manutencao`) |
| `src/app/admin/clientes/[id]/conversas/**` | Lista e leitor de conversas | Exibição das mensagens/tentativas |
| `src/app/api/health/route.ts` | Healthcheck DB + Redis | — |
| `recuperacao/core.ts` | Recorte de 24h, schema de decisão, `PROMPT` | **Reaproveitável** (seção 5) |
| `recuperacao/rodar.ts` | Worker CLI de leitura/classificação | Esqueleto do worker; hoje só lê |
| `recuperacao/core.test.ts` | 5 testes (`node:test`) | Único teste automatizado do repo |
| `bateria/**`, `src/app/api/bateria/**`, `.claude/skills/bateria` | Teste de personas contra a dev | Testa **atendimento**, não o canal |
| `README.md`, `RAIO_X.md` | Documentação | Parcialmente defasados (ver nota na seção 8) |

---

## 5. Componentes reutilizáveis

| Componente | Reuso | Observação |
|---|---|---|
| `recuperacao/core.ts` (`recorte`, `Decisao`, `validarDecisao`, `PROMPT`) | Classificação (passos 3–4) | Valida evidências contra IDs reais; entrada tratada como "dado não confiável". Ver ressalvas em 6.7 |
| Chamada Anthropic do piloto (`rodar.ts`) | Modelo para o classificador | Usa `RECUPERACAO_ANTHROPIC_API_KEY` e `RECUPERACAO_MODELO` próprios, `maxRetries: 0`, timeout 30 s — isola custo e modelo do atendimento |
| `normalizarNumero` | Destino do template | Mesma regra do atendimento (importante para o nono dígito) |
| Padrão de eventos (`registrarEvento`, `resumoErro`) | Auditoria operacional | Só IDs/códigos, nunca texto de lead. Adicionar chaves ao `CATALOGO` não exige migração |
| `registrarResposta` / `RegistroResposta` | Custo e rastreio da classificação | `origem` e `funcao` são `String` no banco; basta ampliar as uniões TS |
| `prisma` singleton, `getRedis()` | Acesso a dados/locks | — |
| `Cliente.status` + `InterruptorGeral` | Kill-switch operacional | `manutencao` já bloqueia o atendimento; o recovery deve respeitar |
| `Encaminhamento` | Exclusão de leads já entregues ao prestador | Já usada pelo piloto |
| `WhatsappConversation.handoffEm`, `revisar` | Sinais de "não mexer" | `revisar` só vira `true` (QA por palavra-chave) |
| `assinaturaValida` (HMAC) | Gerar webhooks assinados em testes | Mesma fórmula, inverso |
| Precedente `[documento enviado]` | Padrão para inserir mensagem de processo externo como `ASSISTANT` | Seção 3.3 |
| Compare-and-set de `resumoAte` | Padrão de atualização condicional | Modelo para "reivindicar" uma tentativa |
| `LinkTeste`/demo e bateria | **Não** reaproveitáveis para o canal | Não têm número nem envio |
| Fallback do piloto | Guard `RAILWAY_ENVIRONMENT_NAME=staging` + `SET TRANSACTION READ ONLY` | Bom padrão de segurança para a fase de calibração |

---

## 6. Lacunas técnicas

### 6.1 Estado de tentativas (nada existe hoje)
Não há onde registrar "tentei recuperar a conversa X, com o template Y, em Z, resultado W". `Encaminhamento` e `Evento` não servem (o primeiro é do pedido do lead; o segundo não guarda texto/estado e não é consultável de forma confiável). É preciso um modelo próprio de tentativa com: conversa, cliente, template, status (máquina de estados), horário-alvo, `wamid` da Meta, motivo de descarte/falha, versão do classificador, chave de idempotência (`@@unique`). **[RECOMENDAÇÃO]** na seção 9.

### 6.2 Configuração por cliente
Nenhum campo de recuperação em `Cliente`. Hoje o cadastro de funcionamento (T8) vive em colunas de `Cliente` + `CadastroForm.tsx` + Zod em `cadastro.ts` + `PUT /api/admin/clientes/[id]`. Precisa de, no mínimo: habilitado (padrão **desligado**), momento da ativação, template aprovado, janela mínima/máxima, descrição do negócio para o classificador, limites diários. Opções na seção 9.

### 6.3 Envio de template
Falta função de envio de `type: 'template'` que **devolva** `wamid`/erro estruturado, mapeamento dos códigos de erro da Meta e uso do token por cliente. **[CONFIRMADO]** que nada disso existe.

### 6.4 Rastreio de entrega
Falta processar `value.statuses` (sent/delivered/read/failed + `errors[]`) e gravar `wamid` de saída. Sem isso, `falhou` e `entregue` são indistinguíveis de "enviado". **[HIPÓTESE]** Os `statuses` chegam no mesmo campo `messages` já assinado no painel da Meta (não exige nova assinatura de campo) — confirmar na configuração do app.

### 6.5 Sinal confiável de "última atividade do lead"
Hoje: `max(WhatsappMessage.createdAt where role=USER)`, defasado pelo debounce/IA, cego a mídia/figurinha/reação, e perde turnos em reinício. Precisa de uma marca gravada **na chegada** (hot path do webhook) ou aceitar margem de segurança. Isso toca o webhook, que é do motor de atendimento — **decisão para a T01** (seção 9).

### 6.6 Origem de anúncio
Persistir `ctwaClid`/`referral`/`referralEm` (colunas já migradas, vazias). Sem isso o Recovery não distingue lead de anúncio de contato orgânico, nem usa o contexto do anúncio. É mudança no webhook, mas **sem migração**.

### 6.7 Do piloto para produção
O piloto (`recuperacao/`) **não** serve como está:
- Avalia o **primeiro** intervalo de 24h da conversa (calibração histórica), não "a conversa está inativa agora".
- Lê conversas `orderBy id asc take limite` — sem filtro de tempo nem de elegibilidade.
- Não grava nada, não envia, não tem estado nem idempotência.
- Exclui por `Encaminhamento` e usa o histórico persistido inteiro (corta em 60 mil caracteres → revisão manual).
- Não considera `status` do cliente, `revisar`, `handoffEm`, opt-out.
- Tem o aviso do próprio README: *"serve à calibração, não à autorização de disparo"*.

### 6.8 Opt-out e consentimento
Não existe campo nem processo. O prompt do piloto trata "recusa explícita/opt-out" como `nao_recuperar`, mas isso depende de a IA ver a recusa **no histórico gravado**; mídia/figurinha/"botão" não são gravados.

### 6.9 Outras lacunas
- **Tipos `button`/`interactive`** são descartados (seção 3.1). Se o template usar botão de resposta rápida, **o toque do lead seria ignorado**. **[HIPÓTESE]** A Meta entrega esse toque como `type: "button"` (quick reply) — confirmar na documentação e em teste; é bloqueante se o template tiver botões.
- **Índice** para "última mensagem USER por conversa" (hoje só `conversationId`). Criar índice em tabela existente tem custo de lock (seção 7).
- **Agendador** e **lock distribuído** (seção 2.5/9).
- **Teste de canal**: nenhum simulador de webhook nem de Cloud API (seção 8).
- **Admin**: sem visão de tentativas; `MessagesReader` só distingue USER/ASSISTANT.
- **Multi-cliente**: token por cliente (6.3).
- **Observabilidade**: eventos novos e, possivelmente, novo `Tema`.

---

## 7. Riscos e limitações

Prioridade: **P0** = bloqueia o go-live ou causa dano a cliente/lead; **P1** = deve ser resolvido na implementação; **P2** = mitigável/aceitável com monitoramento.

| # | Risco | Prio | Evidência / mecanismo | Mitigação sugerida |
|---|---|---|---|---|
| R1 | **Recuperar conversas antigas em massa** ao ligar o recurso | **P0** | Nada limita a idade; qualquer conversa com último USER > 24h seria elegível (o piloto ainda escolhe o *primeiro* gap histórico) **[CONFIRMADO]** (`recuperacao/core.ts` `recorte`) | Janela máxima de idade (ex.: 24h–72h/7d), marca de ativação por cliente (só conversas com atividade *após* ativar), teto diário por cliente, aprovação manual na fase 1 |
| R2 | **Disparo duplicado** | **P0** | Meta não oferece idempotência no envio; dois workers/réplicas, retry ou reinício podem reenviar. Dedupe atual é só de *entrada*, em Redis **[CONFIRMADO]** | `@@unique(conversa, ciclo)` + reivindicação atômica (`UPDATE … WHERE status='pendente'`) **antes** de chamar a Meta; "enviando" órfão → `incerto`, **nunca** reenviar automaticamente; 1 worker + trava |
| R3 | **Enviar depois de o lead voltar a falar** | **P0** | (a) mensagem do lead fica até ~10 s + latência da IA só no Redis/memória, invisível ao banco; (b) mídia/figurinha/reação/`button` não são gravados; (c) turno perdido em reinício **[CONFIRMADO]** | Reverificar imediatamente antes de enviar; marca de atividade na chegada; checar `wa:buf:*`; margem de segurança; cancelar tentativa pendente se chegar mensagem |
| R4 | **Recuperar contato sem interesse / sem permissão** | **P0** | Sem opt-out, sem consentimento no modelo; classificador é probabilístico **[CONFIRMADO]**. Política da Meta para mensagem iniciada pela empresa (opt-in, categoria Marketing, limite por usuário, qualidade do número) **[HIPÓTESE]** | Lista de supressão persistente; classificador conservador (`incerto` → não envia); revisão humana na fase 1; validar política Meta e jurídico (LGPD) antes de produção; monitorar qualidade do número |
| R5 | **Mensagem enviada que não aparece no histórico** (ou o inverso) | **P1** | Fluxo atual grava antes de enviar e ignora erro HTTP **[CONFIRMADO]**; a Meta pode aceitar e depois falhar (status assíncrono) | Gravar a tentativa e a mensagem de histórico de forma coordenada: reivindicar → enviar → gravar `wamid` e `ASSISTANT` marcado; reconciliar por `statuses`. Decidir se gravar histórico só em `enviada`/`entregue` |
| R6 | **Conflito Concierge × Recovery** | **P1** | Não há trava por conversa; "mensagem que chega enquanto a IA responde gera segunda resposta" já é risco aceito no atendimento **[CONFIRMADO]** (`RAIO_X.md` §8) | Recovery só *lê* o histórico e só *escreve* o `ASSISTANT` da tentativa; nunca chama `responderMensagem`; recheck + claim; considerar lock Redis por `clienteId:numero` compartilhado |
| R7 | **Falha/reinício durante o processamento** | **P1** | Processos efêmeros; sem fila **[CONFIRMADO]** | Máquina de estados idempotente e retomável; checkpoint por conversa (o piloto já faz isso em arquivo); estados `enviando` com timeout → `incerto` |
| R8 | **Impacto de migrações em dados existentes** | **P1** | `migrate deploy` roda no boot, em todo deploy, sem gate **[CONFIRMADO]**; `WhatsappMessage` é a maior tabela. Migrações aditivas são seguras; `CREATE INDEX` comum bloqueia escrita durante a criação; Prisma não faz `CONCURRENTLY` dentro da transação padrão **[HIPÓTESE sobre volume]** | Migração só aditiva (nova tabela/colunas anuláveis ou com default constante); índice avaliado por volume real; testar migração em cópia do banco de produção; staging antes de `main`; **nunca** `NOT NULL` sem default em tabela existente |
| R9 | **Dois processos recebendo/enviando** (réplicas) | **P1** | Debounce em `setTimeout` só é correto com 1 instância **[CONFIRMADO]**; réplicas **[VERIFICAR NO AMBIENTE]** | Confirmar 1 réplica; trava no banco |
| R10 | **Token global do WhatsApp** | **P1** (P0 para outros clientes) | `process.env.WHATSAPP_TOKEN` **[CONFIRMADO]** | Usar `Cliente.whatsappToken` no envio de template (decisão T01) |
| R11 | **Template inexistente/reprovado/pausado, parâmetros errados, janela de 24h já aberta** | **P1** | Não há validação de template **[CONFIRMADO]**. Códigos de erro de template/entrega **[HIPÓTESE]** | Pré-validar template por cliente; mapear erros; tratar "janela aberta" (não enviar template se o lead respondeu) |
| R12 | **Privacidade/LGPD: conversas enviadas a LLM** | **P1** | O classificador envia histórico completo ao provedor **[CONFIRMADO]** (`rodar.ts`); log de encaminhamento já grava telefone/nome em texto **[CONFIRMADO]** | Minimizar conteúdo; não logar texto; confirmar termos do provedor; base legal e aviso ao cliente |
| R13 | **Classificador: falso positivo e injeção de prompt** | **P1** | Conteúdo do lead é entrada não confiável **[CONFIRMADO]** (o prompt do piloto já trata); calibração depende de revisão humana | Saída estrita validada (já existe), evidências obrigatórias, conjunto de avaliação separado, versão do prompt gravada |
| R14 | **`updatedAt` mal interpretado como atividade** | **P2** | **[CONFIRMADO]** | Não usar `updatedAt`; usar `max(createdAt)` de USER |
| R15 | **Fuso/limites de horário** | **P2** | Não há "horário comercial de contato" no sistema; helpers de Brasília existem só para o prompt | Definir janela de envio (ex.: 08h–20h BRT) |
| R16 | **Custo de IA sem teto** | **P2** | Nada limita chamadas do worker; `RegistroResposta` ajuda a medir **[CONFIRMADO]** | Limites por execução/dia; modelo próprio (`RECUPERACAO_MODELO`) |
| R17 | **Tabela `Evento` não é auditoria de negócio** | **P2** | Guarda só IDs, sem texto **[CONFIRMADO]** | Auditoria da tentativa fica na tabela própria |
| R18 | **Admin sem trilha de quem ativou** | **P2** | Senha única **[CONFIRMADO]** (`RAIO_X.md` §10.18) | Registrar a ativação (data) e evento |
| R19 | **Documentação defasada** | **P2** | `README`/`RAIO_X.md` dizem "sem testes/CI" e "sem dedup por wamid", o que contradiz o código atual (há `test:recuperacao` e dedupe em Redis) **[CONFIRMADO]** | Atualizar na T01+ |
| R20 | **Build inclui `recuperacao/`** | **P2** | `tsconfig.json` inclui `**/*.ts`; erro de tipo lá quebra `next build` **[CONFIRMADO]** (hoje passa) | Manter `tsc` verde; considerar excluir se crescer |

**Limitações do que foi possível verificar:** não foi executado nenhum fluxo contra Meta, banco real, Redis ou IA; nada foi acessado em Railway ou na Meta.

---

## 8. Estratégia de staging

### 8.1 O que existe — **[CONFIRMADO]**
- Ambiente `staging` ↔ branch `dev` (README). O piloto já assume `RAILWAY_ENVIRONMENT_NAME=staging` e credencial de banco **somente leitura** (`RECUPERACAO_DATABASE_URL`).
- **Bateria de personas** (`npm run bateria`): IA faz o cliente, o Concierge da dev responde via `/api/bateria/...`. **Não passa pelo canal WhatsApp** (README: "a bateria não testa o canal do WhatsApp: junção de mensagens, áudio, envio") e não grava conversa.
- **Link de teste (`/demo/[token]`)**: usa `DemoMensagem`, outra tabela; **sem número de WhatsApp, sem envio** — não serve para recovery.
- **Modo mock**: só para Resend/Cal.com/Kiwify (`*_MODE`). **Não há mock da Cloud API.**
- **Testes automatizados**: 5 testes do piloto (rodam offline, sem banco/IA). Sem teste do webhook, do envio ou do motor; sem CI (`.github` inexistente).
- **Scripts de validação**: `npm run lint`, `npx tsc --noEmit` (passam), `npm run recuperacao -- --arquivo recuperacao/exemplo.json` (simulação offline).
- **Migrações**: `prisma migrate deploy` no boot; `migrate dev` local; Postgres/Redis locais por `docker-compose.yml`.

### 8.2 O que não existe e será necessário
- Simulador de webhook (payload `messages`, `statuses`, `referral`, `button`) **assinado** com `APP_SECRET`.
- Dublê da Cloud API (ou número de teste real) para o envio de template e respostas de erro (`131xxx`/`132xxx`).
- Dados de teste (conversas sintéticas) em staging; **nunca** copiar dados reais de produção.

### 8.3 Dependências externas para homologar o fluxo completo — **[VERIFICAR NO AMBIENTE]**
| Dependência | Para quê |
|---|---|
| Número/WABA de teste e `phoneNumberId` cadastrado em um `Cliente` de staging | Webhook e envio reais |
| Template **aprovado pela Meta** nessa WABA (aprovação pode levar de minutos a dias — **[HIPÓTESE]**) | Envio de recuperação |
| Destinatários de teste permitidos (números de teste da Meta limitam destinatários — **[HIPÓTESE]**) | Receber a mensagem |
| `WHATSAPP_TOKEN` de staging, `APP_SECRET`, `VERIFY_TOKEN`; webhook do app Meta apontando para o staging (ou app separado) | Fluxo ponta a ponta |
| `RECUPERACAO_ANTHROPIC_API_KEY` + `RECUPERACAO_MODELO` | Classificação real |
| Postgres e Redis **exclusivos** de staging | Isolamento |

### 8.4 Sequência segura sugerida — **[RECOMENDAÇÃO]**
1. **Offline**: testes unitários da lógica de elegibilidade/estados com relógio injetado e sem rede.
2. **Staging, dry-run**: o worker calcula e registra *o que enviaria*, **sem chamar a Meta** (modo padrão).
3. **Staging, envio para número de teste** de uma lista de permissão explícita (allowlist) no código/ambiente, nunca "todos os contatos".
4. **Staging, ponta a ponta**: lead de teste responde → conferir que o Concierge continua com a tentativa no histórico.
5. **Produção, sombra**: apenas classificação e relatório, sem envio.
6. **Produção, piloto controlado**: um cliente (Sema), teto diário baixo, aprovação humana.
- Garantias de isolamento: guard `RAILWAY_ENVIRONMENT_NAME`, credencial de banco separada, recurso desligado por padrão, nenhum envio sem allowlist em staging.

---

## 9. Recomendações para a T01 (decisões antes do desenvolvimento)

Estas são decisões que **precisam de resposta do Pedro/negócio** antes de codificar. Nenhuma foi implementada.

### D1. Onde roda e como é acionado
Serviço Railway separado (cron ou loop) × `setInterval` no web × endpoint disparado externamente. **[RECOMENDAÇÃO]** serviço separado, mesmo repositório, comando que termina por execução, com trava no banco. Pré-condição: confirmar cron/réplicas (seção 2.7).

### D2. Modelo de dados (migração)
- **Tentativa/ciclo de recuperação**: tabela própria com máquina de estados (`pendente → classificando → elegível/descartada → enviando → enviada → entregue/falhou/incerto → respondida/expirada`), `@@unique` de idempotência, `wamid`, versão do classificador, motivo.
- **Configuração por cliente**: (a) colunas em `Cliente` (padrão da T8) ou (b) tabela 1:1 `RecuperacaoConfig` (ausência de linha = desligado). **[RECOMENDAÇÃO]** (b), pois preserva a independência do módulo e deixa o padrão "desligado" estrutural. Em ambos: `habilitado` padrão `false`, `ativadoEm`, template, janelas, limites.
- **Supressão/opt-out**: por `(clienteId, numeroContato)`.
- Tudo **aditivo**, tabelas novas, sem alterar `WhatsappMessage`/`WhatsappConversation` na primeira entrega, se possível.

### D3. Como a tentativa entra no histórico
Gravar como `ASSISTANT` com marcador (precedente `[documento enviado]`) × campo de origem em `WhatsappMessage` (migração em tabela existente). Decidir também **quando** gravar (após aceite da Meta × após `delivered`) e o texto exato (o corpo do template renderizado, para o Concierge continuar coerente). Tratar o marcador em `LEAK_MARKERS` e orientar o prompt **sem** mudar o motor além do necessário.

### D4. Mudanças mínimas no webhook (hot path do atendimento)
Quais serão aceitas na T01/T02: (i) processar `statuses`; (ii) aceitar `button`/`interactive`; (iii) gravar `ctwaClid`/`referral`/`referralEm`; (iv) marca de atividade na chegada. Cada uma toca o fluxo que atende clientes hoje — definir ordem, feature flag e teste na bateria/staging. **[RECOMENDAÇÃO]** isolar (i)–(iii) em tarefas pequenas e anteriores ao envio.

### D5. Política de elegibilidade
Janela mínima (24h) e **máxima** (R1), exigir resposta do Concierge antes do silêncio?, limites por contato (1 tentativa por ciclo? por 30 dias?), horário de envio, excluir `Encaminhamento`/`handoffEm`/`revisar`/`status≠ativo`/opt-out, teto diário por cliente, comportamento na ativação (backlog).

### D6. Política Meta e jurídico
Categoria do template (Marketing × Utility), opt-in aceito para quem veio de anúncio, limites por usuário e impacto na qualidade do número, texto do template e idioma, uso de botões (impacta D4-ii). **[VERIFICAR NO AMBIENTE/Meta]** antes de qualquer envio real.

### D7. Token e WABA por cliente
Passar a usar `Cliente.whatsappToken`/`wabaId` no envio de recuperação? Armazenamento seguro do token (hoje texto simples no banco; **[CONFIRMADO]** coluna `String?`).

### D8. Classificador
Reaproveitar `recuperacao/core.ts` como biblioteca compartilhada (hoje está fora de `src/` e é importada só pelo script) × reescrever; local do código; modelo/chave dedicados; critério de aprovação (taxa de falso positivo alvo, conjunto de avaliação), e se na fase 1 há **aprovação humana** de cada envio.

### D9. Reuso do envio
Criar `enviarTemplate` ao lado de `enviarTexto` **sem alterar** o contrato dele; extrair `codigoDoErroMeta`; versão da Graph API (hoje v21.0 fixa) e erros a mapear.

### D10. Observabilidade e operação
Novo tema/eventos no catálogo, tela no admin (mínimo: listar tentativas por cliente), painel de custo (`RegistroResposta` com `origem: 'recuperacao'`), alarme de taxa de falha, kill-switch (status do cliente + flag do módulo + variável global).

### D11. Estratégia de testes
Simulador de webhook/Cloud API, relógio injetável, testes de corrida (lead responde durante o envio), teste de migração em cópia de dados, e critérios de aceite do staging (seção 8.4).

---

## Apêndice A — Perguntas ainda sem resposta (precisam de verificação fora do repositório)

1. O Railway executa quantas réplicas do serviço web em staging e produção?
2. O plano do Railway permite serviço com cron e volume? Existe auto-deploy a cada push em `dev`/`main`?
3. Staging tem Postgres/Redis próprios? Há número/WABA de teste e template aprovado?
4. Qual o volume real de `WhatsappConversation`/`WhatsappMessage` em produção (para decidir índice e tamanho de lote)?
5. Qual `AI_PROVIDER` e quais variáveis estão realmente definidas em cada ambiente (`WHATSAPP_TOKEN`, `APP_SECRET`, `RESEND_MODE`…)?
6. O app da Meta já recebe `statuses` no mesmo campo `messages`? Há outros campos assinados?
7. Quais as regras atuais da Meta para template iniciado pela empresa, opt-in via anúncio e limites por usuário?
8. A Sema tem posição jurídica (LGPD) sobre uso de histórico em LLM de terceiros e sobre contato ativo?
9. Os leads de anúncio chegam com `referral` completo (`source_id`, `ctwa_clid`) no ambiente real? (hoje não é gravado, então não há como saber pelo banco)
10. Como o Concierge deve se comportar quando o lead responde a uma recuperação (script próprio no prompt × só histórico)? — decisão de produto.

## Apêndice B — Arquivos analisados

`package.json`, `tsconfig.json`, `prisma.config.ts`, `docker-compose.yml`, `.env.example`, `.gitignore`, `README.md`, `RAIO_X.md`, `.claude/settings.json`, `.claude/hooks/session-start.sh`, `prisma/schema.prisma`, migrações `20260618…add_whatsapp_conversation`, `20261012…unificar_demo_cliente`, `20261016…resumo_conversa`, `20261019…campos_origem_anuncio` (as demais apenas listadas), `src/app/api/whatsapp/webhook/route.ts`, `src/app/api/health/route.ts`, `src/lib/whatsapp/{send,phone,conversa,turno,assinatura,midia,audio}.ts`, `src/lib/atendimento/{motor,resumo}.ts` (e `encaminhamento`, `pacote`, `destino` por consulta), `src/lib/ai/{config,index,anthropic,registro,validate-output,build-prestador-prompt}.ts`, `src/lib/eventos.ts`, `src/lib/logger.ts`, `src/lib/prisma.ts`, `src/lib/ratelimit/redis.ts`, `src/lib/admin/{interruptor,cadastro,guard}.ts`, `src/lib/bateria/acesso.ts`, `src/lib/documentos/marcador.ts`, `src/app/admin/clientes/[id]/conversas/page.tsx`, `MessagesReader.tsx`, `CadastroForm.tsx` (consulta), `src/app/api/admin/clientes/[id]/status/route.ts`, `recuperacao/{README.md,core.ts,rodar.ts,core.test.ts,exemplo.json}`. Também: `grep` em `src/` por `template`, `statuses`, `setInterval/cron/bullmq/after(`, `ctwaClid/referral`, `whatsappToken/WHATSAPP_TOKEN`, opt-out; `npx tsc --noEmit` e `npm run test:recuperacao` (ambos verdes).
