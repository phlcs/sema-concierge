# Concierge (Sema)

Assistente de atendimento por WhatsApp para prestadores de serviço. Cada prestador é um `Cliente` com um "cérebro" (JSON com serviços, preços, horários e regras). O robô responde quem escreve para o número do prestador, usa só o que está no cérebro e, quando o caso pede, manda um e-mail de handoff com os dados do lead. Existe também uma demo web para prospects e um painel admin para ler conversas e editar o cérebro.

Para um retrato detalhado do código (prompt, cérebro, handoff, pontos frágeis), veja [`RAIO_X.md`](./RAIO_X.md).

## Stack

- Next.js 16 (App Router), React 19, TypeScript
- PostgreSQL com Prisma 7 (`@prisma/adapter-pg`)
- Redis (`ioredis`), hoje usado só no healthcheck
- Zod para validar a saída da IA
- Tailwind CSS 4
- IA: Anthropic, Gemini ou OpenAI, escolhida por `AI_PROVIDER`
- WhatsApp Cloud API da Meta, direto, sem BSP
- E-mail de handoff: Resend (adapter com modo `mock` e `real`)
- Deploy: Railway (servidor Node persistente, `next start`)

## Fluxo de uma mensagem

1. A Meta faz `POST /api/whatsapp/webhook`.
2. O corpo cru é lido e o cabeçalho `X-Hub-Signature-256` é conferido com `APP_SECRET`. Com `APP_SECRET` definida, evento sem assinatura válida é recusado (401) e registrado no log. Sem ela, o webhook aceita tudo e registra um aviso a cada evento.
3. O servidor responde `200` e processa em seguida. Texto e áudio são tratados: o áudio é baixado pelo media ID, transcrito e entra no turno como texto (ver "Áudio" abaixo). Imagem, documento e vídeo recebem uma frase fixa pedindo texto; os demais tipos são descartados.
4. O `Cliente` é localizado pelo `phone_number_id`. Status `manutencao` responde com texto fixo; qualquer status diferente de `ativo` não responde.
5. `normalizarNumero()` define a chave da conversa. Números do Brasil (começam com 55) recebem a regra do nono dígito; os demais são usados exatamente como a Meta enviou.
6. `responderMensagem()` valida a entrada, carrega as últimas 40 mensagens, monta o prompt com o cérebro e chama a IA. Qualquer erro vira uma resposta de fallback.
7. A mensagem do contato e a resposta são gravadas e a resposta é enviada pela Graph API (`enviarTexto`).
8. Palavras-chave sensíveis marcam a conversa para revisão (`revisar`).
9. Se a IA sinalizar `suggestBook`, o handoff é enviado por e-mail ao prestador, com cooldown de 24h por conversa.

## Rotas

APIs:

| Rota | O que faz |
|---|---|
| `GET /api/health` | Checa Postgres e Redis |
| `GET /api/whatsapp/webhook` | Verificação do webhook pela Meta (`VERIFY_TOKEN`) |
| `POST /api/whatsapp/webhook` | Recebe eventos da Meta |
| `POST /api/admin/login` | Login do admin (`ADMIN_PASSWORD`) |
| `POST /api/admin/logout` | Logout do admin |
| `POST /api/admin/clientes/[id]/cerebro` | Salva o cérebro do cliente |
| `POST /api/admin/clientes/[id]/status` | Altera o status do cliente |
| `GET /api/admin/clientes/[id]/conversas/[conversaId]/mensagens` | Lê mensagens de uma conversa |
| `POST /demo/[token]/mensagem` | Mensagem na demo |
| `POST /demo/[token]/reiniciar` | Reinicia a sessão da demo |

Páginas: `/`, `/admin`, `/admin/login`, `/admin/clientes`, `/admin/clientes/[id]/cerebro`, `/admin/clientes/[id]/conversas`, `/admin/clientes/[id]/conversas/[conversaId]` e `/demo/[token]`.

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
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Envio do e-mail de handoff no modo `real` |
| `CALCOM_MODE`, `KIWIFY_MODE` | Modos dos adapters sem uso (ver abaixo) |

`APP_SECRET` é opcional por segurança de rollout: sem ela o webhook não verifica a assinatura (e avisa no log a cada evento). Com ela errada, o robô para de responder; para voltar, apague a variável no Railway, sem novo deploy. Troque a chave primeiro no staging.

## Áudio

- Todo cliente `ativo` lê áudio. O webhook baixa o arquivo na hora (a URL da Meta vale 5 minutos), transcreve com `AI_AUDIO_MODEL` e usa o texto como se tivesse sido digitado, dentro da espera de 10s do turno. A transcrição começa na chegada do áudio e corre em paralelo à espera.
- Só o texto é guardado, sempre começando com `[áudio transcrito]` (aparece no histórico e no painel). O áudio fica só em memória e nunca é gravado.
- Limite de 2min30. A duração é lida do próprio arquivo Ogg/Opus (a Meta não informa); para outros formatos vale um teto de 2,5 MB. Acima disso, o cliente recebe `FRASE_AUDIO_LONGO`. Se a transcrição falhar (sem chave, erro da OpenAI, texto vazio), recebe `FRASE_MIDIA`.
- Número, data ou nome que venham de áudio e entrem num encaminhamento são confirmados com a pessoa antes (regra no prompt, em `<audio_e_midia>`).
- Sem `OPENAI_API_KEY` o áudio cai sempre na frase fixa, com aviso no log.

## Rodando localmente

```bash
cp .env.example .env     # preencha as variáveis
docker compose up -d     # Postgres 16 e Redis 7
npm install
npx prisma migrate dev
npm run dev
```

Scripts: `dev`, `build`, `start` (roda `prisma migrate deploy` antes), `lint` e `seed` (o `prisma/seed.ts` está vazio). Não há testes automatizados nem CI.

Clientes e demos não têm tela de criação: são inseridos direto no banco. A cada boot, `src/instrumentation.ts` cria um cliente "Teste".

## Deploy

Railway, com ambiente `staging` ligado à branch `dev`. Configure as variáveis acima em cada ambiente, com `JWT_SECRET` diferente entre eles. O Postgres e o Redis vêm dos plugins do Railway. O healthcheck é `/api/health`. Mudanças no webhook (como a assinatura) devem passar pelo staging antes da produção.

## Código que existe mas não é usado

- Integração Kiwify (`src/lib/integrations/kiwify/`): não é importada por nenhuma rota.
- `sendBookingConfirmation` (`src/lib/integrations/resend/`): sem chamador; no modo `real` lança "não implementado". Só `enviarHandoff` é usado.
- Campos `checklist` e `steps` da resposta da IA (`src/lib/ai/schema.ts`): o prompt manda ficarem `null` e nada os exibe.
- Campo `Cliente.whatsappToken`: o envio usa `WHATSAPP_TOKEN`.

Guardados para uso futuro:

- `checkRateLimit` (`src/lib/ratelimit/`): ainda não é chamado; será ligado ao webhook no item 7.3.
- Integração Cal.com (`src/lib/integrations/calcom/`): prevista para o item 5.7.
