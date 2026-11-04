# T02 — Estrutura de dados · Lead Recovery

Tarefa só de estrutura de dados. Nenhuma lógica de recuperação, webhook, classificador, worker, agendador, envio, interface administrativa, prompt, Railway ou variável de ambiente foi tocada.

- **Base:** branch `dev`, a partir do commit `53f0806` (T01).
- **Referência técnica:** `T01_ARQUITETURA.md` §5. As decisões aprovadas depois da T01 prevalecem onde divergem dela (seção 2).
- **Migração:** `prisma/migrations/20261104120000_recuperacao_estrutura/migration.sql`. **Criada, não aplicada em produção.**

---

## 1. O que foi entregue

| Item | Arquivo |
|---|---|
| Cinco tabelas e relações inversas | `prisma/schema.prisma` |
| Migração versionada | `prisma/migrations/20261104120000_recuperacao_estrutura/migration.sql` |
| Testes da estrutura (Postgres real, banco isolado) | `recuperacao/testes/estrutura-dados.test.ts` |
| Script para subir um Postgres descartável | `recuperacao/testes/banco-teste.sh` |
| Script `test:recuperacao:dados` | `package.json` (nenhum script existente muda) |
| Este relatório | `docs/lead-recovery/T02_ESTRUTURA_DADOS.md` |

Tabelas: `RecuperacaoConfig`, `AtividadeContato`, `RecuperacaoAvaliacao`, `RecuperacaoEnvio`, `RecuperacaoBloqueio`.

---

## 2. Decisões incorporadas e desvios do modelo da T01

| # | Tema | T01 | T02 | Motivo |
|---|---|---|---|---|
| 1 | Unicidade do envio | `@@unique([clienteId, numeroContato])` incondicional | **Índice único parcial** (seção 3) | Rejeição definitiva da Meta e cancelamento anterior a qualquer chamada precisam liberar nova tentativa |
| 2 | `RecuperacaoEnvio.avaliacaoId` | `@unique` | FK composta com índice, **sem** unicidade | A nova tentativa após rejeição reutiliza a mesma avaliação |
| 3 | Dias de envio | seg–sáb (`{1..6}`) | **todos os dias** (`{0..6}`) | Decisão aprovada: 09h–20h, todos os dias |
| 4 | `RecuperacaoAvaliacao.modo` | não existia | `simulacao` \| `real`, **dentro da chave única** | Simulação e real do mesmo ciclo não podem colidir; o resultado simulado fica identificado como tal |
| 5 | `AtividadeContato` | sem `ultimoWamid` e sem contador | `ultimoWamid` e `versao` (padrão 1) | Referência da Meta e checagem otimista de concorrência, além do `FOR UPDATE` da T01 |
| 6 | Envio ↔ avaliação | FK simples | **FK composta** `(avaliacaoId, clienteId, numeroContato)` | O banco garante que o envio pertence ao mesmo cliente e contato da avaliação |
| 7 | Domínios fechados | só comentário | `CHECK` em `modo`, `status`, `decisao`, janela de horas, dias da semana e número só com dígitos | Um valor com erro de digitação não pode ocupar nem liberar a oportunidade por engano |

Retenção:

- **Conversa apagada:** `RecuperacaoEnvio.conversaId` vira nulo (`SET NULL`). A auditoria fica inteira e a oportunidade continua consumida.
- **Linha do histórico removida:** `mensagemId` não tem FK, então a auditoria sobrevive.
- **Cliente apagado:** as cinco tabelas saem em cascata, no padrão do repositório e da T01.
- **Avaliação com envio:** não pode ser apagada (`NO ACTION`).

---

## 3. A regra de unicidade e como o banco a garante

**Regra.** Por `(clienteId, numeroContato)` existe no máximo **uma** linha de `RecuperacaoEnvio` que ocupa a oportunidade de recuperação.

| Situação do envio | Ocupa a oportunidade? |
|---|---|
| `enviando`, `aceito`, `entregue`, `lido`, `falhou`, `incerto` | **Sim** (aceito ou resultado desconhecido) |
| `adiado` (Meta recusou por limite temporário, mesma linha será retomada) | **Sim** |
| `cancelado` **com** chamada à Meta registrada (`tentativasMeta ≥ 1`, `wamid` ou erro) | **Sim**, por segurança |
| `rejeitado` (rejeição definitiva da Meta, sem aceite) | **Não** |
| `cancelado` comprovadamente anterior a qualquer chamada (`tentativasMeta = 0`, sem `wamid`, sem erro) | **Não** |

**Mecanismo.** Índice único parcial, escrito à mão na migração (o Prisma não o declara; a seção 4 mostra que isso não gera drift):

```sql
CREATE UNIQUE INDEX "RecuperacaoEnvio_oportunidade_key"
  ON "RecuperacaoEnvio" ("clienteId", "numeroContato")
  WHERE NOT (
    "status" = 'rejeitado'
    OR ("status" = 'cancelado' AND "tentativasMeta" = 0
        AND "wamid" IS NULL AND "erroCodigo" IS NULL AND "erroHttp" IS NULL)
  );
```

**Por que esta solução:**

1. **Vale para qualquer cliente do banco.** `INSERT` concorrente, `UPDATE` que tente reviver uma linha liberada e SQL manual passam pelo mesmo índice. Não depende da aplicação.
2. **Lista negativa, falha fechada.** Só as duas condições acima liberam. Qualquer outra combinação ocupa a vaga.
3. **A linha liberada fica como auditoria.** A nova tentativa é uma linha nova, então o erro da Meta e os horários da primeira permanecem.
4. **Concorrência correta.** Com duas transações abertas, a segunda **espera** a primeira. Se a primeira confirma, a segunda falha com violação de unicidade. Se a primeira dá rollback, a segunda passa. Isso casa com "reivindicar antes de chamar a Meta" (T01 §3.D).

**Como o banco "prova" que o cancelamento foi anterior a qualquer chamada.** Sem isso, o campo seria só uma promessa da aplicação:

- `CHECK`: todo estado que implica contato com a Meta (`aceito`, `entregue`, `lido`, `falhou`, `incerto`, `adiado`, `rejeitado`) exige `tentativasMeta ≥ 1`. Ter `wamid` também exige.
- Gatilho `BEFORE UPDATE OF tentativasMeta`: o contador **nunca diminui**. Não dá para zerar uma linha que já falou com a Meta, cancelá-la e liberar a vaga.

**Contrato para a T08 (orquestrador).** Gravar `tentativasMeta = 1` (commit) **antes** do HTTP. Se o processo morrer depois da chamada, a linha fica `enviando` com contador 1, vira `incerto` e continua consumindo. `cancelado` só é alcançado de forma deliberada, antes do HTTP.

**Erro que a aplicação verá quando perder a corrida.** Medido contra o banco de teste:

| Forma de escrita | Erro |
|---|---|
| `prisma.recuperacaoEnvio.create` | `P2002`, com `originalCode 23505` e o nome do índice `RecuperacaoEnvio_oportunidade_key` |
| SQL cru (`$executeRaw`) | `P2010`, com `originalCode 23505` |

A T08 deve tratar os dois como `ja_tentado`.

---

## 4. Compatibilidade com o que existe

- **Migração 100% aditiva.** O SQL só contém `CREATE TABLE`, `CREATE INDEX`, `CREATE FUNCTION`, `CREATE TRIGGER` e `ALTER TABLE ... ADD CONSTRAINT`. Todos os `ALTER TABLE` são nas cinco tabelas novas. Não há `DROP`, `UPDATE`, `DELETE` ou `TRUNCATE`. O teste 3b verifica isso automaticamente.
- **Tabelas existentes inalteradas.** `Cliente` e `WhatsappConversation` ganham apenas campos de relação **virtuais** no schema Prisma. Nenhuma coluna, índice ou restrição nova nelas. (O `prisma format` realinhou os espaços de algumas linhas desses dois modelos: o `git diff` mostra 16 linhas "removidas", mas `git diff -w` mostra só adições, 163 no `schema.prisma`.) O teste 2 compara contagens, conteúdo (hash por tabela), colunas, índices e restrições de todas as tabelas antigas antes e depois da migração, com dados sintéticos. Resultado idêntico.
- **Sem mudança funcional.** Nenhum arquivo de `src/` foi modificado. O motor, o webhook, os prompts e o envio estão intactos. O único arquivo existente tocado além do schema é `package.json`, para um script novo.
- **Clientes existentes ficam com a recuperação desligada.** Nenhuma linha de `RecuperacaoConfig` é criada. Sem linha, o módulo está desligado.
- **Prisma 7.8.0.** Schema válido e já formatado. O `migrate diff` entre o banco migrado e o `schema.prisma` é vazio, então o Prisma não vê drift e não tentará derrubar o índice parcial, os `CHECK`s nem o gatilho numa futura `migrate dev`.
- **Efeito no deploy.** `npm start` roda `prisma migrate deploy`. A migração é aplicada no próximo boot do ambiente que receber este commit. Em tabelas novas e vazias, o custo é o lock curto de FK em `Cliente` e `WhatsappConversation` (T01 §5).

---

## 5. Validação executada

Ambiente: PostgreSQL **16.15** local, descartável, só em socket Unix, criado por `recuperacao/testes/banco-teste.sh`. Cada execução cria um banco `t02_*` próprio e o apaga. Nenhum dado real, nenhuma variável `DATABASE_URL` de ambiente, nenhum acesso a Railway.

| # | Verificação | Resultado |
|---|---|---|
| 1 | `npx prisma validate` | Schema válido |
| 2 | `npx prisma generate` | Client 7.8.0 gerado |
| 3 | `npx tsc --noEmit` | Sem erros |
| 4 | `npm run build` | Passou |
| 5 | `npm run test:recuperacao` (testes existentes) | **5/5** |
| 6 | `npm run test:recuperacao:dados` (novos, Postgres real) | **40/40**, em duas execuções seguidas, sem instabilidade |
| 7 | `npm run lint` (projeto inteiro) | **Falha com 2 erros e 4 avisos que já existem no commit-base** (ver seção 7). Os arquivos novos estão limpos |

### Cenários exigidos, com o teste que os cobre

| Cenário | Teste(s) |
|---|---|
| Configuração ausente significa recuperação desligada | 4, 5 |
| Simulação não consome a oportunidade real | 14 |
| Duas tentativas válidas simultâneas não são permitidas | 15, 15b, 15c |
| Rejeição definitiva comprovada permite nova tentativa | 16 |
| Cancelamento anterior a qualquer chamada libera; com chamada consome | 16b, 16c, 16d, 16e |
| Envio aceito, desconhecido ou em andamento impede outra tentativa | 16a (7 estados) |
| Exclusão de conversa não apaga a auditoria | 19, 19b |

Os testes 15 e 15b **provam o bloqueio**: a segunda transação é vista em `pg_stat_activity` esperando por lock antes de a primeira confirmar. O 15c dispara 10 reivindicações paralelas e exatamente 1 vence.

### Os testes detectam o defeito que deveriam detectar (teste de mutação)

Alterei temporariamente a migração e reexecutei a suíte. A migração foi restaurada em seguida, com hash idêntico ao original.

| Mutação | Resultado |
|---|---|
| Índice sem a exceção do cancelado (`WHERE status <> 'rejeitado'`) | 2 falhas: 16b e 17 |
| Sem índice parcial algum | 18 falhas, incluindo toda a concorrência |
| Índice incondicional (modelo original da T01) | 5 falhas, incluindo 16 (rejeição) e 16b (cancelamento) |

### Reversão validada

O script de reversão da seção 8 foi executado no banco de teste: removeu as cinco tabelas, a função e o registro da migração; o banco ficou idêntico ao schema anterior (`migrate diff` vazio); a migração foi reaplicada sem erro.

### Limitações desta validação

- **Não testado sobre uma cópia de dados de produção** (nenhum dado real foi acessado, por restrição da tarefa). A compatibilidade foi provada com dados sintéticos.
- **Versão do Postgres do Railway não verificada** **[VERIFICAR NO AMBIENTE]**. Os testes usam 16.15. O SQL usa recursos antigos (índice parcial, `CHECK`, gatilho `plpgsql`) e não deve depender da versão.
- **Tempo e lock da criação das FKs não medidos com volume.** Em tabelas novas e vazias, a expectativa é de milissegundos, mas é a única operação que toca `Cliente` e `WhatsappConversation`.
- **"Sem linha significa desligado" é garantia estrutural, não lógica.** O banco garante o padrão `desligado` e que nenhuma linha nasce sozinha. Quem interpreta a ausência é o código da T06/T08.
- **Docker não foi usado.** O `docker-compose.yml` do repositório continua válido como alternativa para quem rodar os testes.

---

## 6. Como rodar os testes da estrutura

```bash
# 1) Postgres descartável (socket local, usuário "postgres"); imprime a URL
recuperacao/testes/banco-teste.sh start

# 2) Suíte (cria e apaga bancos t02_* próprios)
TESTE_DATABASE_URL="postgresql://postgres@localhost/postgres?host=/tmp/t02-pg/sock" \
  npm run test:recuperacao:dados

# 3) Encerrar
recuperacao/testes/banco-teste.sh stop
```

- Sem `TESTE_DATABASE_URL`, a suíte sai como **skipped**, nunca como aprovada.
- Trava de segurança: o teste recusa host que não seja local e recusa rodar com `RAILWAY_ENVIRONMENT_NAME` definido.
- Com o `docker-compose.yml` do repositório: `docker compose up -d postgres` e aponte `TESTE_DATABASE_URL` para ele. O teste só cria e apaga bancos com prefixo `t02_`.

---

## 7. Riscos e pendências

| # | Item | Gravidade | Observação |
|---|---|---|---|
| 1 | **`npm run lint` falha no commit-base.** 2 erros (`<a>` em vez de `<Link />`) em `src/app/error.tsx:109` e `src/app/not-found.tsx:70`, mais 4 avisos de variável não usada em `src/lib/integrations/*/mock.ts`. Confirmado com o trabalho da T02 em stash: os mesmos 6 problemas. | Baixa | Não vem da T02 e não foi corrigido, para não misturar escopo |
| 2 | **Domínios fechados exigem migração para crescer.** Um status novo de envio ou avaliação precisa de `ALTER ... DROP/ADD CONSTRAINT` e, no envio, de revisão do índice parcial. | Baixa | É a contrapartida de o banco recusar valores inválidos. Está documentado nesta seção e no comentário do SQL |
| 3 | **Cancelado com chamada registrada consome a oportunidade.** Inclui o `adiado` que o lead cancelou ao voltar. | Média, decisão de produto | Segue o princípio da T01 de preferir evitar duplicidade a aproveitar a oportunidade. Afrouxar é uma migração de uma linha |
| 4 | **Cliente apagado leva a auditoria junto (cascata).** | Média, decisão de produto | Padrão do repositório. Para auditoria que sobreviva à exclusão do cliente, a FK com `Cliente` teria que sair, o que é uma mudança de modelo |
| 5 | **A garantia depende de a T08 gravar `tentativasMeta = 1` antes do HTTP.** | Média | Contrato descrito na seção 3. O banco impede o contorno por zerar o contador, mas não obriga a gravar antes |
| 6 | **Quem tem acesso de superusuário pode desativar o gatilho ou derrubar o índice.** | Baixa | Inerente a qualquer garantia de banco |
| 7 | **O `push` de `dev` pode aplicar a migração no staging**, se houver auto-deploy. | Baixa | **[VERIFICAR NO AMBIENTE]**. Tabelas novas e vazias, sem efeito no atendimento |
| 8 | **Opt-in, LGPD e aprovação do template da Meta** continuam pendentes. | Alta para a T13, nenhuma para a T02 | Fora do escopo desta tarefa |

---

## 8. Aplicação em staging

Quem executa é o Pedro, ou outra pessoa com autorização explícita. Nada disso foi feito nesta tarefa.

### 8.1 Antes

1. Confirme que está apontando para o **Postgres de staging** e não para o de produção. A migração **não** deve ser aplicada em produção antes do merge aprovado em `main`.
2. Faça um backup (snapshot do plugin Postgres do Railway ou `pg_dump`).
3. Registre as contagens atuais para comparar depois:

```sql
SELECT 'Cliente' t, count(*) FROM "Cliente"
UNION ALL SELECT 'WhatsappConversation', count(*) FROM "WhatsappConversation"
UNION ALL SELECT 'WhatsappMessage', count(*) FROM "WhatsappMessage"
UNION ALL SELECT 'Encaminhamento', count(*) FROM "Encaminhamento"
UNION ALL SELECT 'Evento', count(*) FROM "Evento";
```

4. Confirme o estado das migrações. Esperado: 16 aplicadas e 1 pendente (`20261104120000_recuperacao_estrutura`).

```bash
npx prisma migrate status
```

### 8.2 Aplicar

Caminho normal: o deploy do serviço web a partir de `dev` roda `prisma migrate deploy` no `npm start` e aplica a migração sozinho. Se o auto-deploy de `dev` estiver ligado, isso acontece no push. Caminho manual:

```bash
# DATABASE_URL = URL do Postgres de STAGING
npx prisma migrate deploy
```

### 8.3 Conferir

```sql
-- 1) As cinco tabelas existem e estão vazias
SELECT table_name FROM information_schema.tables
WHERE table_schema='public' AND (table_name LIKE 'Recuperacao%' OR table_name='AtividadeContato') ORDER BY 1;

-- 2) O índice parcial existe
SELECT indexdef FROM pg_indexes WHERE indexname = 'RecuperacaoEnvio_oportunidade_key';

-- 3) O gatilho existe
SELECT tgname FROM pg_trigger WHERE tgname = 'RecuperacaoEnvio_tentativasMeta_monotona';
```

Depois repita a consulta de contagens do 8.1: **os números têm de ser idênticos**. E confirme que não há drift:

```bash
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
# esperado: "-- This is an empty migration."
```

### 8.4 Teste de fumaça do atendimento

1. `GET /api/health` responde 200.
2. Mande uma mensagem ao número de teste do staging e confirme que o Concierge responde normalmente.
3. Confirme que nenhuma linha foi criada nas cinco tabelas: o módulo continua desligado.

### 8.5 Reversão

Só se a migração tiver de ser desfeita. Não é uma migração versionada. As tabelas novas não têm efeito no atendimento, então desfazer não afeta nenhum dado existente.

```sql
BEGIN;
DROP TABLE "RecuperacaoEnvio";   -- derruba também o gatilho e o índice parcial
DROP FUNCTION "RecuperacaoEnvio_tentativasMeta_monotona"();
DROP TABLE "RecuperacaoAvaliacao";
DROP TABLE "AtividadeContato";
DROP TABLE "RecuperacaoBloqueio";
DROP TABLE "RecuperacaoConfig";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261104120000_recuperacao_estrutura';
COMMIT;
```

---

## 9. Confirmação de ausência de alterações funcionais

- Nenhum arquivo em `src/` foi modificado. `git diff --stat` do commit lista apenas `package.json`, `prisma/schema.prisma`, a migração, `recuperacao/testes/**` e este documento.
- Nenhuma tabela existente teve coluna, índice ou restrição alterada, e nenhum dado foi tocado (teste 2).
- Nenhum comportamento do atendimento, do webhook, dos prompts ou do envio mudou. `npm run build` e `npx tsc --noEmit` passam.
- Nada foi aplicado em produção ou em staging. Railway e variáveis de ambiente não foram tocados. Não houve deploy nem merge para `main`.
- A T03 não foi iniciada.
