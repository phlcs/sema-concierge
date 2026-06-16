# Pergunte ao seu Contador

Plataforma web com assistente de IA para dúvidas de IR + agendamento de sessão paga com contador.

## Stack

- **Next.js 16** (App Router, TypeScript, Tailwind CSS v4)
- **PostgreSQL** via Docker (dev) / plugin Railway (produção)
- **Prisma ORM** com migrações versionadas
- **Redis** via Docker (dev) / plugin Railway (produção)
- **JWT** em cookie httpOnly para autenticação
- **Zod** para validação de input

---

## Setup local (GitHub Codespace / Ubuntu)

### 1. Variáveis de ambiente

Copie o arquivo de exemplo:

```bash
cp .env.example .env
```

Edite o `.env` se precisar trocar valores. Para desenvolvimento local, os padrões já funcionam.

### 2. Subir o banco de dados e Redis (Docker)

```bash
docker compose up -d
```

Isso sobe um PostgreSQL 16 (porta `5432`) e um Redis 7 (porta `6379`). Os dados ficam num volume nomeado `postgres_data` — sobrevive a restarts.

Para verificar que estão rodando:

```bash
docker compose ps
```

### 3. Instalar dependências

```bash
npm install
```

O `postinstall` roda `prisma generate` automaticamente.

### 4. Aplicar o schema no banco

Na primeira vez (cria as tabelas):

```bash
npx prisma migrate dev
```

Isso roda todas as migrações em `prisma/migrations/` em ordem.

### 5. Rodar o servidor de desenvolvimento

```bash
npm run dev
```

Acesse: [http://localhost:3000](http://localhost:3000)

### 6. (Opcional) Criar dados de demonstração

```bash
npm run seed
```

Cria o usuário `demo@pergunteaoseucontador.com.br` / senha `demo12345`, duas conversas de exemplo e um booking confirmado. **Só use em dev ou staging — nunca em produção.**

---

## Configurando a IA

### Provider Anthropic (padrão)

1. Acesse [console.anthropic.com](https://console.anthropic.com) e crie uma API key
2. No `.env`, preencha:
   ```
   AI_PROVIDER=anthropic
   ANTHROPIC_API_KEY=sk-ant-...
   ANTHROPIC_MODEL=claude-haiku-4-5
   ```

### Provider Google Gemini (alternativo)

1. Acesse [ai.google.dev](https://ai.google.dev) e crie uma API key
2. No `.env`, preencha:
   ```
   AI_PROVIDER=gemini
   GOOGLE_API_KEY=AIza...
   GEMINI_MODEL=gemini-2.5-flash
   ```

Trocar o provider é instantâneo — apenas mude `AI_PROVIDER` e reinicie o servidor.

### Limites de uso configuráveis

| Variável | Padrão | Descrição |
|---|---|---|
| `DAILY_USER_LIMIT` | `5` | Perguntas por usuário por dia |
| `DAILY_GLOBAL_LIMIT` | `200` | Total de perguntas por dia (kill switch) |
| `MIN_SECONDS_BETWEEN_MESSAGES` | `8` | Intervalo mínimo entre mensagens do mesmo usuário |

---

## Como trocar mocks por integrações reais

### Cal.com (agendamento)

1. Crie uma conta em [cal.com](https://cal.com) e configure um Event Type de 1 hora
2. Gere uma API key em **Settings → Developer → API Keys**
3. No `.env`:
   ```
   CALCOM_MODE=real
   CALCOM_API_KEY=cal_live_xxxx
   CALCOM_EVENT_TYPE_ID=12345
   ```
4. Implemente `src/lib/integrations/calcom/real.ts`

### Kiwify (pagamento)

1. Crie uma conta em [kiwify.com.br](https://kiwify.com.br) e cadastre o produto
2. Em **Dashboard → Configurações → Integrações**, configure o webhook para `https://seudominio.com/api/payment/webhook`
3. No `.env`:
   ```
   KIWIFY_MODE=real
   KIWIFY_PUBLIC_KEY=xxxx
   KIWIFY_SECRET_KEY=xxxx
   KIWIFY_WEBHOOK_SECRET=xxxx
   ```
4. Implemente `src/lib/integrations/kiwify/real.ts`

### Resend (e-mail)

1. Crie uma conta em [resend.com](https://resend.com), gere uma API key e verifique seu domínio
2. No `.env`:
   ```
   RESEND_MODE=real
   RESEND_API_KEY=re_xxxx
   RESEND_FROM_EMAIL=contato@seudominio.com.br
   ```
3. Implemente `src/lib/integrations/resend/real.ts`

### Rotas DEV ONLY

| Rota | Descrição | Desabilitada quando |
|---|---|---|
| `/booking/mock-checkout` | Tela fake do Kiwify com botões Aprovar/Recusar | `NODE_ENV=production` ou `KIWIFY_MODE=real` |
| `POST /api/payment/simulate` | Simula aprovação/recusa de pagamento | `NODE_ENV=production` ou `KIWIFY_MODE=real` |

---

## Deploy no Railway — passo a passo

> **Pré-requisito:** conta no Railway ([railway.app](https://railway.app)) com cartão de crédito cadastrado.
> O deploy em si é feito por você no painel do Railway. Este guia explica cada passo.
>
> **Como o build funciona:** Railway detecta automaticamente o Next.js via Nixpacks. Não há Dockerfile, `.dockerignore` nem `railway.toml`. Basta conectar o repositório, adicionar Postgres + Redis e configurar as variáveis de ambiente abaixo.

### 1. Criar o projeto no Railway

1. Acesse [railway.app/new](https://railway.app/new)
2. Clique em **"Empty Project"**
3. Dê o nome **"pergunte-ao-seu-contador"**

### 2. Adicionar plugin Postgres

1. No projeto, clique em **"+ Add Service"**
2. Escolha **"Database" → "PostgreSQL"**
3. O Railway cria o banco e injeta `DATABASE_URL` automaticamente — você não precisa copiar nada.

### 3. Adicionar plugin Redis

1. Clique em **"+ Add Service"** novamente
2. Escolha **"Database" → "Redis"**
3. O Railway cria o Redis e injeta `REDIS_URL` automaticamente.

### 4. Conectar ao repositório GitHub

1. Clique em **"+ Add Service"** → **"GitHub Repo"**
2. Autorize o acesso ao GitHub se necessário
3. Selecione o repositório `pergunteaosecontador`

### 5. Criar dois environments

1. No topo do projeto, clique em **"Environments"**
2. Renomeie o environment padrão para **`production`** (ou crie um novo)
3. Crie um segundo environment chamado **`staging`**

### 6. Configurar qual branch vai para qual environment

Para cada environment, nas configurações do serviço web:
- **`production`** → branch **`main`**
- **`staging`** → branch **`dev`**

No painel do serviço web, em **"Settings" → "Source"**, defina o branch correspondente.

### 7. Variáveis de ambiente por environment

Configure estas variáveis em **cada environment** separadamente. Acesse **"Variables"** no serviço web de cada environment.

**Variáveis que têm o mesmo valor em staging e produção:**

| Variável | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `AI_PROVIDER` | `anthropic` (ou `gemini`) |
| `ANTHROPIC_MODEL` | `claude-haiku-4-5` |
| `GEMINI_MODEL` | `gemini-2.5-flash` |
| `DAILY_GLOBAL_LIMIT` | `200` |
| `DAILY_USER_LIMIT` | `5` |
| `MIN_SECONDS_BETWEEN_MESSAGES` | `8` |
| `CALCOM_MODE` | `mock` (até ter credenciais reais) |
| `KIWIFY_MODE` | `mock` (até ter credenciais reais) |
| `RESEND_MODE` | `mock` (até ter credenciais reais) |
| `SESSION_PRICE_CENTS` | `19700` |
| `SESSION_DURATION_MINUTES` | `60` |

**Variáveis diferentes por environment:**

| Variável | Staging | Produção |
|---|---|---|
| `DATABASE_URL` | Auto-injetada pelo plugin Postgres do Railway | Auto-injetada pelo plugin Postgres do Railway |
| `REDIS_URL` | Auto-injetada pelo plugin Redis do Railway | Auto-injetada pelo plugin Redis do Railway |
| `JWT_SECRET` | Gere com `openssl rand -base64 64` | Gere um valor **diferente** com `openssl rand -base64 64` |
| `ANTHROPIC_API_KEY` | Sua chave Anthropic (pode ser a mesma) | Sua chave Anthropic |
| `GOOGLE_API_KEY` | Sua chave Google (pode ser a mesma) | Sua chave Google |
| `NEXT_PUBLIC_BASE_URL` | URL do staging (ex: `https://staging-xyz.up.railway.app`) | URL de produção (ex: `https://pergunteaoseucontador.com.br`) |
| `RESEND_FROM_EMAIL` | `staging@pergunteaoseucontador.com.br` | `contato@pergunteaoseucontador.com.br` |

> **Como gerar o JWT_SECRET:**
> ```bash
> openssl rand -base64 64
> ```
> Rode duas vezes — uma para staging, uma para produção. Nunca reutilize o mesmo valor.

### 8. Primeira migração do banco

Após o primeiro deploy (ou sempre que precisar rodar migrações manualmente), execute via Railway CLI:

```bash
# Instale o Railway CLI se ainda não tiver
npm install -g @railway/cli

# Faça login
railway login

# Selecione o projeto e environment correto
railway environment staging  # ou production

# Rode as migrações
railway run npx prisma migrate deploy
```

> Na prática, isso raramente será necessário — o script `start` inclui `prisma migrate deploy`, que roda automaticamente a cada vez que o container sobe. O `build` não acessa o banco (só gera o client e compila o Next.js).

### 9. Subir o seed em staging (nunca em produção)

Para criar dados de demonstração no ambiente de staging:

```bash
railway environment staging
railway run npm run seed
```

**Nunca rode o seed em produção.** Ele cria um usuário demo com senha conhecida publicamente.

### 10. Ver logs e métricas

No painel do Railway:
- Clique no serviço web
- Aba **"Logs"** — logs em tempo real (JSON em produção)
- Aba **"Metrics"** — CPU, memória e requisições

Para filtrar por nível de log, use a busca: `"level":"error"` ou `"level":"warn"`.

### 11. Healthcheck

Configure o healthcheck no painel do Railway: **Settings → Healthcheck Path → `/api/health`**.

Para verificar manualmente:
```bash
curl https://suaurl.up.railway.app/api/health
# Resposta esperada:
# {"status":"ok","db":"ok","redis":"ok","timestamp":"2025-..."}
```

Se `status` for `degraded`, verifique logs de conexão com Postgres ou Redis.

### 12. Rollback em caso de problema

No painel do Railway:
1. Clique no serviço web
2. Aba **"Deployments"**
3. Encontre o deploy anterior (status "Success")
4. Clique em **"Redeploy"** naquele deploy

Isso reverte instantaneamente para a versão anterior sem nenhum código.

---

## Rotina de operação (fluxo dev → produção)

```
Codespace (branch dev)
       │
       │  git push origin dev
       ▼
Railway Staging (automático)
       │
       │  testar manualmente em staging
       │  verificar /api/health, login, chat, booking
       ▼
Pull Request: dev → main (GitHub)
       │
       │  merge (você aprova no GitHub)
       ▼
Railway Produção (automático)
       │
       │  verificar /api/health em produção
       │  teste rápido de smoke: login → chat → mensagem
       ▼
Tudo OK ✅
```

**Resumindo o dia a dia:**

1. Trabalhe sempre na branch `dev` no Codespace
2. Commite pequeno e frequente
3. `git push origin dev` → Railway deploya em staging automaticamente
4. Teste em staging
5. Se OK: abra um Pull Request `dev → main` no GitHub e faça o merge
6. Railway deploya em produção automaticamente
7. Verifique o healthcheck e faça um teste rápido em produção
8. **Bug em produção:** rollback no Railway (passo 12 acima) + corrija em `dev` + repita o fluxo

---

## Custos esperados

| Serviço | Plano | Estimativa mensal |
|---|---|---|
| **Railway** — Hobby Plan | $5 fixo + uso | ~$10–15/mês (inclui Postgres, Redis e serviço web) |
| **Anthropic Haiku** | Pay-as-you-go | ~$0.002/mensagem — com 200 msgs/dia = ~$0.40/dia = ~$12/mês |
| **Google Gemini Flash** | Free tier + pay-as-you-go | Gratuito para volumes baixos; abaixo de 200 msgs/dia |
| **Cal.com** | Free | $0 (plano gratuito cobre o caso de uso) |
| **Kiwify** | Por transação | ~3–5% por venda (pago pelo comprador, sem mensalidade) |
| **Resend** | Free até 3.000 emails/mês | $0 no começo |

> Estimativa total de infraestrutura para começar: **~$15–20/mês** usando Gemini, ou **~$25–30/mês** usando Anthropic Haiku com volume máximo.

---

## Estrutura do projeto

```
src/
  app/
    api/
      auth/        POST login, signup, logout; GET me
      booking/     GET slots; POST booking; GET/DELETE /[id]
      chat/send/   POST — envia mensagem e retorna resposta da IA
      conversations/ GET/POST conversas; GET mensagens; DELETE
      health/      GET — healthcheck (Postgres + Redis)
      payment/     POST simulate (DEV); POST webhook
    app/
      chat/        ChatPage com BookingModal integrado
      bookings/    Lista de agendamentos do usuário
    booking/
      mock-checkout/ DEV ONLY — simulador de pagamento
      success/       Tela de confirmação pós-pagamento
      cancel/        Tela de cancelamento
    login/         Login + cadastro (JWT)
    error.tsx      Página de erro global (marca)
    not-found.tsx  Página 404 (marca)
    page.tsx       Landing page pública
  components/
    BookingModal.tsx  Wizard de agendamento (3 passos)
    BookingsList.tsx  Lista de agendamentos
    ChatFab.tsx       FAB flutuante de acesso ao chat
    NavAuthLink.tsx   Link dinâmico login/app na nav
    LandingFaq.tsx    FAQ accordion
    LogoutButton.tsx  Botão de logout
  lib/
    ai/            LLM (Anthropic + Gemini), validação de input/output
    auth.ts        JWT sign/verify + helpers de cookie
    integrations/  Adapters: calcom, kiwify, resend (mock + real stub)
    logger.ts      Logger estruturado (JSON em produção)
    prisma.ts      Singleton do Prisma Client
    ratelimit/     Rate limiting com Redis
  generated/
    prisma/        Cliente Prisma gerado (não editar manualmente)
prisma/
  schema.prisma   Schema (User, Conversation, Message, Booking, Payment, UsageLog)
  migrations/     Migrações versionadas
  seed.ts         Dados de demonstração (só dev/staging)
docker-compose.yml  Postgres + Redis locais (só dev)
.env.example      Variáveis necessárias com comentários
```
