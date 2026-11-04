// T02 · Testes da estrutura de dados do Lead Recovery, contra PostgreSQL REAL e isolado.
//
//   TESTE_DATABASE_URL=postgresql://... npm run test:recuperacao:dados
//
// Sem TESTE_DATABASE_URL a suíte inteira sai como SKIPPED (nunca como aprovada).
// Cada execução cria bancos "t02_*" próprios, aplica as migrações com `prisma migrate
// deploy` (o mesmo caminho do deploy) e os apaga no fim. Não lê DATABASE_URL nem .env.
// Para subir um Postgres descartável: recuperacao/testes/banco-teste.sh start
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PrismaClient } from '../../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const URL_BASE = process.env.TESTE_DATABASE_URL
const RAIZ = process.cwd()
const MIGRACOES = join(RAIZ, 'prisma', 'migrations')
const PRISMA_BIN = join(RAIZ, 'node_modules', '.bin', 'prisma')
const NOVAS_TABELAS = [
  'RecuperacaoConfig',
  'AtividadeContato',
  'RecuperacaoAvaliacao',
  'RecuperacaoEnvio',
  'RecuperacaoBloqueio',
]

// ─── Trava de segurança: só banco local, nunca ambiente Railway ──────────────
function exigirBancoLocal(url: string): URL {
  const u = new URL(url)
  const host = u.searchParams.get('host')
  const hostOk = ['localhost', '127.0.0.1', '[::1]', ''].includes(u.hostname)
  const socketOk = host === null || host.startsWith('/') || ['localhost', '127.0.0.1'].includes(host)
  if (!hostOk || !socketOk || process.env.RAILWAY_ENVIRONMENT_NAME) {
    throw new Error('TESTE_DATABASE_URL recusada: só banco local, fora do Railway')
  }
  return u
}
function urlDoBanco(base: URL, nome: string): string {
  const u = new URL(base.toString())
  u.pathname = `/${nome}`
  return u.toString()
}

// ─── Utilidades ──────────────────────────────────────────────────────────────
const novoCliente = (url: string) => new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
const sufixo = () => randomBytes(4).toString('hex')

function psql(url: string, ...args: string[]): string {
  return execFileSync('psql', [url, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', ...args], {
    encoding: 'utf8',
  }).trim()
}
function migrarComPrisma(url: string) {
  execFileSync(PRISMA_BIN, ['migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url },
    cwd: RAIZ,
    stdio: 'pipe',
  })
}
const texto = (e: unknown) => {
  const x = e as { message?: string; meta?: unknown; code?: string }
  return `${x?.code ?? ''} ${x?.message ?? String(e)} ${JSON.stringify(x?.meta ?? {})}`
}
const ehUnico = (e: unknown) => /P2002|23505|duplicate key|Unique constraint/i.test(texto(e))
const ehCheck = (e: unknown) => /23514|check constraint|nao pode diminuir/i.test(texto(e))
const ehFk = (e: unknown) => /P2003|23503|foreign key/i.test(texto(e))

async function rejeita(p: Promise<unknown>, teste: (e: unknown) => boolean, rotulo: string) {
  try {
    await p
  } catch (e) {
    assert.ok(teste(e), `${rotulo}: erro inesperado: ${texto(e).slice(0, 300)}`)
    return
  }
  assert.fail(`${rotulo}: deveria ter sido recusado pelo banco`)
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

// ─── Suíte ───────────────────────────────────────────────────────────────────
describe('T02 · estrutura de dados do Lead Recovery', {
  skip: URL_BASE ? false : 'TESTE_DATABASE_URL ausente: banco de teste indisponível, nada foi verificado',
}, () => {
  const base = URL_BASE ? exigirBancoLocal(URL_BASE) : (undefined as unknown as URL)
  const nomeBanco = `t02_${sufixo()}`
  const nomeCompat = `t02_${sufixo()}_compat`
  let admin: PrismaClient
  let db: PrismaClient
  let urlDb: string

  before(async () => {
    admin = novoCliente(urlDoBanco(base, 'postgres'))
    await admin.$executeRawUnsafe(`CREATE DATABASE "${nomeBanco}"`)
    urlDb = urlDoBanco(base, nomeBanco)
    migrarComPrisma(urlDb) // caminho real de deploy
    db = novoCliente(urlDb)
  })

  after(async () => {
    await db?.$disconnect()
    for (const n of [nomeBanco, nomeCompat]) {
      await admin?.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${n}" WITH (FORCE)`)
    }
    await admin?.$disconnect()
  })

  // Fábricas: cada teste usa um cliente novo, então nada interfere em nada.
  let seq = 0
  const numero = () => `5511${String(900000000 + ++seq)}`
  async function cliente(client = db) {
    return client.cliente.create({
      data: { nomeNegocio: `Teste ${sufixo()}`, emailPrestador: 't@example.com', cerebro: {} },
    })
  }
  async function avaliacao(
    clienteId: string,
    numeroContato: string,
    over: Partial<{ referenciaEm: Date; modo: string; status: string }> = {},
    client = db,
  ) {
    return client.recuperacaoAvaliacao.create({
      data: { clienteId, numeroContato, referenciaEm: new Date('2026-11-01T12:00:00Z'), modo: 'real', ...over },
    })
  }
  async function envio(
    a: { id: string; clienteId: string; numeroContato: string },
    over: Record<string, unknown> = {},
    client = db,
  ) {
    return client.recuperacaoEnvio.create({
      data: {
        clienteId: a.clienteId,
        numeroContato: a.numeroContato,
        avaliacaoId: a.id,
        status: 'aceito',
        tentativasMeta: 1,
        templateNome: 'retomada_v1',
        templateIdioma: 'pt_BR',
        corpo: 'Oi! Ainda posso te ajudar?',
        ...over,
      },
    })
  }
  const contagemEnvios = (clienteId: string) => db.recuperacaoEnvio.count({ where: { clienteId } })

  // ═══ Migração ══════════════════════════════════════════════════════════════
  describe('migração', () => {
    test('1. migrate deploy cria as 5 tabelas, o índice parcial, os CHECKs e o gatilho', async () => {
      const tabelas = psql(urlDb, '-c', `select table_name from information_schema.tables where table_schema='public'`).split('\n')
      for (const t of NOVAS_TABELAS) assert.ok(tabelas.includes(t), `tabela ausente: ${t}`)

      const idx = psql(urlDb, '-c', `select indexdef from pg_indexes where indexname='RecuperacaoEnvio_oportunidade_key'`)
      assert.match(idx, /UNIQUE/)
      assert.match(idx, /WHERE/)

      const checks = Number(psql(urlDb, '-c', `select count(*) from pg_constraint where contype='c' and conname like '%_check'`))
      assert.ok(checks >= 14, `CHECKs encontrados: ${checks}`)
      assert.equal(psql(urlDb, '-c', `select count(*) from pg_trigger where tgname='RecuperacaoEnvio_tentativasMeta_monotona'`), '1')
    })

    test('2. migração sobre dados existentes não altera nada das tabelas antigas', async () => {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${nomeCompat}"`)
      const url = urlDoBanco(base, nomeCompat)
      const dirs = readdirSync(MIGRACOES, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()
      const ultima = dirs[dirs.length - 1]
      assert.match(ultima, /recuperacao_estrutura$/, 'a migração do Lead Recovery deve ser a última')

      for (const d of dirs.slice(0, -1)) psql(url, '-f', join(MIGRACOES, d, 'migration.sql'))

      // Dados sintéticos nas tabelas existentes (nenhum dado real)
      psql(url, '-c', `
        insert into "Cliente"(id,"nomeNegocio","emailPrestador",cerebro,"updatedAt")
          values ('c1','Negócio A','a@x.com','{}',now()),('c2','Negócio B','b@x.com','{}',now());
        insert into "WhatsappConversation"(id,"clienteId","numeroContato","updatedAt")
          values ('w1','c1','5511911111111',now()),('w2','c2','5511922222222',now());
        insert into "WhatsappMessage"(id,"conversationId",role,texto)
          values ('m1','w1','USER','oi'),('m2','w1','ASSISTANT','olá'),('m3','w2','USER','preço?');
        insert into "Encaminhamento"(id,"clienteId","conversaId",campos) values ('e1','c1','w1','[]');
        insert into "Evento"(id,tema,evento,gravidade) values ('v1','teste','x','info');`)

      const existentes = psql(url, '-c', `select table_name from information_schema.tables
        where table_schema='public' and table_type='BASE TABLE' and table_name <> '_prisma_migrations' order by 1`).split('\n')
      const lista = existentes.map((t) => `'${t}'`).join(',')
      const foto = () => ({
        dados: existentes.map((t) =>
          psql(url, '-c', `select '${t}', count(*), md5(coalesce(string_agg(x::text, '|' order by x::text),'')) from "${t}" x`)),
        colunas: psql(url, '-c', `select table_name,column_name,data_type,is_nullable,column_default
          from information_schema.columns where table_schema='public' and table_name in (${lista}) order by 1,ordinal_position`),
        indices: psql(url, '-c', `select indexdef from pg_indexes where schemaname='public' and tablename in (${lista}) order by 1`),
        restricoes: psql(url, '-c', `select conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid)
          from pg_constraint where conrelid in (select oid from pg_class where relname in (${lista})) order by 1`),
      })
      const antes = foto()
      assert.ok(antes.dados.some((l) => l.startsWith('Cliente|2|')), 'dados sintéticos não entraram')

      psql(url, '-f', join(MIGRACOES, ultima, 'migration.sql')) // a migração do T02
      assert.deepEqual(foto(), antes, 'a migração alterou tabelas existentes')

      // Clientes existentes continuam sem configuração: recuperação desligada
      for (const t of NOVAS_TABELAS) assert.equal(psql(url, '-c', `select count(*) from "${t}"`), '0', `${t} deveria nascer vazia`)
    })

    test('3. o schema.prisma e o banco migrado não têm drift (o Prisma não derrubaria o índice parcial)', () => {
      const saida = execFileSync(PRISMA_BIN, ['migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--script'], {
        env: { ...process.env, DATABASE_URL: urlDb },
        cwd: RAIZ,
        encoding: 'utf8',
      })
      assert.match(saida, /empty migration/i, `drift detectado:\n${saida}`)
    })

    test('3b. o SQL da migração só cria objetos novos (sem DROP/UPDATE/DELETE e sem ALTER em tabela existente)', () => {
      const dir = readdirSync(MIGRACOES).filter((n) => n.endsWith('recuperacao_estrutura'))[0]
      const sql = readFileSync(join(MIGRACOES, dir, 'migration.sql'), 'utf8').replace(/^--.*$/gm, '')
      // Comandos no início de linha: "ON DELETE CASCADE" das FKs novas não conta
      assert.doesNotMatch(sql, /^\s*(DROP|UPDATE|DELETE|TRUNCATE|INSERT)\b/im)
      const alteradas = [...sql.matchAll(/ALTER TABLE "(\w+)"/g)].map((m) => m[1])
      for (const t of alteradas) assert.ok(NOVAS_TABELAS.includes(t), `ALTER TABLE em tabela existente: ${t}`)
    })
  })

  // ═══ Configuração e valores padrão ═════════════════════════════════════════
  describe('RecuperacaoConfig', () => {
    test('4. valores padrão: desligada, 09h–20h, todos os dias, sem ativação', async () => {
      const c = await cliente()
      const cfg = await db.recuperacaoConfig.create({ data: { clienteId: c.id } })
      assert.equal(cfg.modo, 'desligado')
      assert.equal(cfg.ativadoEm, null)
      assert.equal(cfg.templateIdioma, 'pt_BR')
      assert.equal(cfg.horaInicio, 9)
      assert.equal(cfg.horaFim, 20)
      assert.deepEqual(cfg.diasSemana, [0, 1, 2, 3, 4, 5, 6])
      assert.equal(cfg.templateNome, null)
    })

    test('5. configuração ausente significa desligado (nenhuma linha nasce sozinha)', async () => {
      const c = await cliente()
      assert.equal(await db.recuperacaoConfig.count({ where: { clienteId: c.id } }), 0)
      const [r] = await db.$queryRaw<{ modo: string }[]>`
        select coalesce(rc."modo", 'desligado') as modo
        from "Cliente" c left join "RecuperacaoConfig" rc on rc."clienteId" = c.id
        where c.id = ${c.id}`
      assert.equal(r.modo, 'desligado')
      // Nem as demais tabelas ganham linha ao criar o cliente
      for (const t of ['AtividadeContato', 'RecuperacaoAvaliacao', 'RecuperacaoEnvio', 'RecuperacaoBloqueio']) {
        const [n] = await db.$queryRawUnsafe<{ n: bigint }[]>(`select count(*) as n from "${t}" where "clienteId" = $1`, c.id)
        assert.equal(Number(n.n), 0, t)
      }
    })

    test('6. CHECKs recusam modo inválido, janela invertida ou fora do intervalo e dias inválidos', async () => {
      const casos: [string, Record<string, unknown>][] = [
        ['modo inválido', { modo: 'ligado' }],
        ['hora início > fim', { horaInicio: 20, horaFim: 9 }],
        ['hora início = fim', { horaInicio: 9, horaFim: 9 }],
        ['hora início negativa', { horaInicio: -1 }],
        ['hora início 24', { horaInicio: 24, horaFim: 24 }],
        ['hora fim 25', { horaFim: 25 }],
        ['dias vazio', { diasSemana: [] }],
        ['dia 7', { diasSemana: [1, 7] }],
      ]
      for (const [rotulo, dados] of casos) {
        const c = await cliente()
        await rejeita(db.recuperacaoConfig.create({ data: { clienteId: c.id, ...dados } }), ehCheck, rotulo)
      }
      // Valores válidos nos limites passam
      const c = await cliente()
      await db.recuperacaoConfig.create({ data: { clienteId: c.id, modo: 'real', horaInicio: 0, horaFim: 24, diasSemana: [6] } })
    })

    test('7. uma configuração por cliente (PK 1:1)', async () => {
      const c = await cliente()
      await db.recuperacaoConfig.create({ data: { clienteId: c.id } })
      await rejeita(db.recuperacaoConfig.create({ data: { clienteId: c.id } }), ehUnico, 'segunda config')
    })
  })

  // ═══ Atividade ═════════════════════════════════════════════════════════════
  describe('AtividadeContato', () => {
    const dados = (clienteId: string, numeroContato: string) => ({
      clienteId, numeroContato, fromBruto: numeroContato, ultimaEntradaEm: new Date('2026-11-01T10:00:00Z'), ultimoTipo: 'text',
    })

    test('8. única por cliente+contato; mesmo número em outro cliente é permitido; número só com dígitos', async () => {
      const [c1, c2, n] = [await cliente(), await cliente(), numero()]
      const a = await db.atividadeContato.create({ data: dados(c1.id, n) })
      assert.equal(a.versao, 1)
      await rejeita(db.atividadeContato.create({ data: dados(c1.id, n) }), ehUnico, 'duplicada')
      await db.atividadeContato.create({ data: dados(c2.id, n) })
      await rejeita(db.atividadeContato.create({ data: dados(c1.id, '+55 11 9999') }), ehCheck, 'não-dígitos')
      await rejeita(db.atividadeContato.create({ data: dados(c1.id, '') }), ehCheck, 'vazio')
    })

    test('8b. a chave suporta upsert atômico (ON CONFLICT) com GREATEST e contador de versão', async () => {
      const [c, n] = [await cliente(), numero()]
      const upsert = (quando: Date) => db.$executeRaw`
        insert into "AtividadeContato"(id,"clienteId","numeroContato","fromBruto","ultimaEntradaEm","ultimoTipo")
        values (${'a' + sufixo()}, ${c.id}, ${n}, ${n}, ${quando}, 'text')
        on conflict ("clienteId","numeroContato") do update
          set "ultimaEntradaEm" = greatest("AtividadeContato"."ultimaEntradaEm", excluded."ultimaEntradaEm"),
              "versao" = "AtividadeContato"."versao" + 1`
      await upsert(new Date('2026-11-01T10:00:00Z'))
      await upsert(new Date('2026-11-01T12:00:00Z'))
      await upsert(new Date('2026-11-01T09:00:00Z')) // reentrega antiga não adianta o relógio
      const a = await db.atividadeContato.findFirstOrThrow({ where: { clienteId: c.id } })
      assert.equal(a.ultimaEntradaEm.toISOString(), '2026-11-01T12:00:00.000Z')
      assert.equal(a.versao, 3)
      assert.equal(await db.atividadeContato.count({ where: { clienteId: c.id } }), 1)
    })
  })

  // ═══ Avaliação ═════════════════════════════════════════════════════════════
  describe('RecuperacaoAvaliacao', () => {
    test('9. várias avaliações por contato (uma por referência); duplicata recusada', async () => {
      const [c, n] = [await cliente(), numero()]
      await avaliacao(c.id, n, { referenciaEm: new Date('2026-11-01T10:00:00Z') })
      await avaliacao(c.id, n, { referenciaEm: new Date('2026-11-03T10:00:00Z') })
      await avaliacao(c.id, n, { referenciaEm: new Date('2026-11-05T10:00:00Z') })
      assert.equal(await db.recuperacaoAvaliacao.count({ where: { clienteId: c.id, numeroContato: n } }), 3)
      await rejeita(avaliacao(c.id, n, { referenciaEm: new Date('2026-11-03T10:00:00Z') }), ehUnico, 'mesma referência e modo')
    })

    test('9b. simulada e real do mesmo ciclo coexistem; domínios fechados; decisão e evidências persistem', async () => {
      const [c, n] = [await cliente(), numero()]
      const ref = new Date('2026-11-01T10:00:00Z')
      await avaliacao(c.id, n, { referenciaEm: ref, modo: 'simulacao' })
      const real = await db.recuperacaoAvaliacao.create({
        data: {
          clienteId: c.id, numeroContato: n, referenciaEm: ref, modo: 'real', status: 'classificada',
          decisao: 'recuperar', motivo: 'Perguntou preço', evidencias: ['m1'], sinais: { optout: false },
          modelo: 'modelo-x', versaoPrompt: 'recuperacao-v2',
        },
      })
      assert.deepEqual(real.evidencias, ['m1'])
      assert.equal(real.falhasIa, 0)
      assert.equal(real.status, 'classificada')
      const padrao = await avaliacao(c.id, n, { referenciaEm: new Date('2026-11-09T10:00:00Z') })
      assert.equal(padrao.status, 'pendente') // padrão
      await rejeita(avaliacao(c.id, n, { referenciaEm: new Date('2026-11-10T10:00:00Z'), status: 'qualquer' }), ehCheck, 'status inválido')
      await rejeita(avaliacao(c.id, n, { referenciaEm: new Date('2026-11-11T10:00:00Z'), modo: 'dry' }), ehCheck, 'modo inválido')
      await rejeita(
        db.recuperacaoAvaliacao.create({ data: { clienteId: c.id, numeroContato: n, referenciaEm: new Date('2026-11-12T10:00:00Z'), modo: 'real', decisao: 'talvez' } }),
        ehCheck, 'decisão inválida')
    })

    test('10. estados de revisão manual são aceitos', async () => {
      const [c, n] = [await cliente(), numero()]
      for (const [i, status] of ['aguardando_revisao', 'aprovada', 'rejeitada', 'erro_definitivo', 'bloqueada_verificacao', 'cancelada_atividade'].entries()) {
        await avaliacao(c.id, n, { referenciaEm: new Date(Date.UTC(2026, 10, 1 + i)), status })
      }
      assert.equal(await db.recuperacaoAvaliacao.count({ where: { clienteId: c.id } }), 6)
    })
  })

  // ═══ Bloqueio ══════════════════════════════════════════════════════════════
  describe('RecuperacaoBloqueio', () => {
    test('11. um bloqueio por cliente+contato, com origem e momento; outro cliente é independente', async () => {
      const [c1, c2, n] = [await cliente(), await cliente(), numero()]
      const b = await db.recuperacaoBloqueio.create({ data: { clienteId: c1.id, numeroContato: n, origem: 'palavra_chave', motivo: 'pare' } })
      assert.equal(b.origem, 'palavra_chave')
      assert.ok(Math.abs(Date.now() - b.criadoEm.getTime()) < 60_000)
      await rejeita(db.recuperacaoBloqueio.create({ data: { clienteId: c1.id, numeroContato: n, origem: 'manual' } }), ehUnico, 'duplicado')
      await db.recuperacaoBloqueio.create({ data: { clienteId: c2.id, numeroContato: n, origem: 'manual' } })
      await rejeita(db.recuperacaoBloqueio.create({ data: { clienteId: c1.id, numeroContato: 'abc', origem: 'manual' } }), ehCheck, 'não-dígitos')
    })
  })

  // ═══ Relacionamentos ═══════════════════════════════════════════════════════
  describe('relacionamentos', () => {
    test('12. envio só aceita avaliação do mesmo cliente e do mesmo contato (FK composta)', async () => {
      const [c1, c2, n] = [await cliente(), await cliente(), numero()]
      const a = await avaliacao(c1.id, n)
      await envio(a) // ok
      await rejeita(envio({ id: a.id, clienteId: c2.id, numeroContato: n }), ehFk, 'cliente diferente')
      await rejeita(envio({ id: a.id, clienteId: c1.id, numeroContato: numero() }), ehFk, 'contato diferente')
      // Contato novo: com o mesmo contato o índice único (que dispara antes da FK) responderia primeiro
      await rejeita(envio({ id: 'inexistente', clienteId: c1.id, numeroContato: numero() }), ehFk, 'avaliação inexistente')
    })

    test('12b. wamid é único; vários nulos são permitidos', async () => {
      const [c, n1, n2, n3] = [await cliente(), numero(), numero(), numero()]
      const a2 = await avaliacao(c.id, n2)
      await envio(await avaliacao(c.id, n1), { wamid: 'wamid.ABC' })
      await rejeita(envio(a2, { wamid: 'wamid.ABC' }), ehUnico, 'wamid repetido')
      await envio(a2, { status: 'enviando', tentativasMeta: 0, wamid: null })
      await envio(await avaliacao(c.id, n3), { status: 'enviando', tentativasMeta: 0, wamid: null })
      assert.equal(await contagemEnvios(c.id), 3) // dois sem wamid + o primeiro
    })

    test('13. vínculo envio ↔ avaliação ↔ conversa; envio guarda erros, carimbos e wamid', async () => {
      const [c, n] = [await cliente(), numero()]
      const conversa = await db.whatsappConversation.create({ data: { clienteId: c.id, numeroContato: n } })
      const a = await avaliacao(c.id, n)
      const e = await envio(a, {
        conversaId: conversa.id, status: 'falhou', wamid: 'wamid.XYZ', erroCodigo: 131049, erroHttp: 200,
        erroTitulo: 'Limite de marketing', categoriaCobranca: 'marketing', aceitoEm: new Date(), falhouEm: new Date(),
      })
      const lido = await db.recuperacaoEnvio.findUniqueOrThrow({ where: { id: e.id }, include: { avaliacao: true, conversa: true } })
      assert.equal(lido.avaliacao.id, a.id)
      assert.equal(lido.conversa?.id, conversa.id)
      assert.equal(lido.erroCodigo, 131049)
    })
  })

  // ═══ Regra de envio único ══════════════════════════════════════════════════
  describe('unicidade da oportunidade de envio', () => {
    test('14. simulação não consome a oportunidade real', async () => {
      const [c, n] = [await cliente(), numero()]
      const ref = new Date('2026-11-01T10:00:00Z')
      const sim = await avaliacao(c.id, n, { referenciaEm: ref, modo: 'simulacao', status: 'simulado_enviaria' })
      await db.recuperacaoAvaliacao.update({ where: { id: sim.id }, data: { corpoSimulado: 'Oi! Ainda posso te ajudar?' } })
      assert.equal(await contagemEnvios(c.id), 0, 'simulação não pode gerar RecuperacaoEnvio')
      const real = await avaliacao(c.id, n, { referenciaEm: ref, modo: 'real', status: 'classificada' })
      await envio(real) // o envio real continua possível
      assert.equal(await contagemEnvios(c.id), 1)
    })

    test('15. dois processos reivindicando ao mesmo tempo: o segundo espera e falha quando o primeiro confirma', async () => {
      const [c, n] = [await cliente(), numero()]
      const a = await avaliacao(c.id, n)
      const cA = novoCliente(urlDb)
      const cB = novoCliente(urlDb)
      try {
        const aberto = deferred()
        const liberar = deferred()
        const txA = cA.$transaction(async (tx) => {
          await tx.recuperacaoEnvio.create({ data: { clienteId: c.id, numeroContato: n, avaliacaoId: a.id, status: 'enviando', templateNome: 't', templateIdioma: 'pt_BR', corpo: 'x' } })
          aberto.resolve()
          await liberar.promise // transação A segue aberta (sem commit)
        })
        await aberto.promise
        // B tenta a mesma reivindicação enquanto A ainda não confirmou
        const tentativaB = envio(a, { status: 'enviando', tentativasMeta: 0 }, cB).then(() => 'ok', (e: unknown) => e)
        // Prova de que B está BLOQUEADO esperando A (e não falhou por outro motivo)
        await esperarPor(async () => {
          const [r] = await admin.$queryRaw<{ n: bigint }[]>`
            select count(*) as n from pg_stat_activity where datname = ${nomeBanco} and wait_event_type = 'Lock'`
          return Number(r.n) >= 1
        }, 'B deveria estar bloqueado esperando a transação de A')
        liberar.resolve()
        await txA // A confirma
        const resultadoB = await tentativaB
        assert.notEqual(resultadoB, 'ok', 'B não pode ter sucesso depois que A confirmou')
        assert.ok(ehUnico(resultadoB), `B deveria falhar por unicidade: ${texto(resultadoB).slice(0, 200)}`)
        assert.equal(await contagemEnvios(c.id), 1)
      } finally {
        await Promise.all([cA.$disconnect(), cB.$disconnect()])
      }
    })

    test('15b. se a primeira reivindicação der rollback, a segunda passa', async () => {
      const [c, n] = [await cliente(), numero()]
      const a = await avaliacao(c.id, n)
      const cA = novoCliente(urlDb)
      const cB = novoCliente(urlDb)
      try {
        const aberto = deferred()
        const liberar = deferred()
        const txA = cA.$transaction(async (tx) => {
          await tx.recuperacaoEnvio.create({ data: { clienteId: c.id, numeroContato: n, avaliacaoId: a.id, status: 'enviando', templateNome: 't', templateIdioma: 'pt_BR', corpo: 'x' } })
          aberto.resolve()
          await liberar.promise
          throw new Error('rollback proposital')
        }).catch(() => 'rollback')
        await aberto.promise
        const tentativaB = envio(a, { status: 'enviando', tentativasMeta: 0 }, cB)
        await esperarPor(async () => {
          const [r] = await admin.$queryRaw<{ n: bigint }[]>`
            select count(*) as n from pg_stat_activity where datname = ${nomeBanco} and wait_event_type = 'Lock'`
          return Number(r.n) >= 1
        }, 'B deveria estar bloqueado')
        liberar.resolve()
        assert.equal(await txA, 'rollback')
        const b = await tentativaB
        assert.equal(b.status, 'enviando')
        assert.equal(await contagemEnvios(c.id), 1)
      } finally {
        await Promise.all([cA.$disconnect(), cB.$disconnect()])
      }
    })

    test('15c. 10 reivindicações paralelas do mesmo contato: exatamente 1 vence', async () => {
      const [c, n] = [await cliente(), numero()]
      const a = await avaliacao(c.id, n)
      const resultados = await Promise.allSettled(
        Array.from({ length: 10 }, () => envio(a, { status: 'enviando', tentativasMeta: 0 })),
      )
      const ok = resultados.filter((r) => r.status === 'fulfilled')
      const falhas = resultados.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      assert.equal(ok.length, 1)
      assert.equal(falhas.length, 9)
      for (const f of falhas) assert.ok(ehUnico(f.reason), texto(f.reason).slice(0, 200))
      assert.equal(await contagemEnvios(c.id), 1)
    })

    test('16. rejeição definitiva da Meta (sem aceite) permite nova tentativa e preserva a auditoria da rejeitada', async () => {
      const [c, n] = [await cliente(), numero()]
      const a = await avaliacao(c.id, n)
      const rej = await envio(a, { status: 'rejeitado', erroCodigo: 132001, erroHttp: 400, erroTitulo: 'Template inexistente' })
      const nova = await envio(a, { status: 'enviando', tentativasMeta: 0 }) // após corrigir o problema
      assert.notEqual(nova.id, rej.id)
      const original = await db.recuperacaoEnvio.findUniqueOrThrow({ where: { id: rej.id } })
      assert.equal(original.status, 'rejeitado')
      assert.equal(original.erroCodigo, 132001)
      assert.equal(original.erroTitulo, 'Template inexistente')
      // Várias rejeitadas podem coexistir (histórico), mesmo com uma ativa
      await envio(a, { status: 'rejeitado', erroCodigo: 132015, erroHttp: 400 })
      await envio(a, { status: 'rejeitado', erroCodigo: 132016, erroHttp: 400 })
      assert.equal(await contagemEnvios(c.id), 4)
      // A tentativa ativa volta a ocupar a vaga: nenhuma outra ativa entra
      await rejeita(envio(a, { status: 'enviando', tentativasMeta: 0 }), ehUnico, 'segunda ativa')
      // Mesmo depois de aceita, continua único
      await db.recuperacaoEnvio.update({ where: { id: nova.id }, data: { status: 'aceito', tentativasMeta: 1, wamid: 'wamid.OK1', aceitoEm: new Date() } })
      await rejeita(envio(a, { status: 'enviando', tentativasMeta: 0 }), ehUnico, 'nova após aceito')
    })

    for (const status of ['enviando', 'aceito', 'entregue', 'lido', 'falhou', 'incerto', 'adiado']) {
      test(`16a. estado "${status}" ocupa a oportunidade: segunda tentativa recusada`, async () => {
        const [c, n] = [await cliente(), numero()]
        const a = await avaliacao(c.id, n)
        await envio(a, { status, tentativasMeta: status === 'enviando' ? 0 : 1 })
        await rejeita(envio(a, { status: 'enviando', tentativasMeta: 0 }), ehUnico, `segunda após ${status}`)
        await rejeita(envio(a, { status: 'aceito' }), ehUnico, `aceita após ${status}`)
        assert.equal(await contagemEnvios(c.id), 1)
      })
    }

    test('16b. cancelamento comprovadamente anterior a qualquer chamada à Meta libera a oportunidade', async () => {
      const [c, n] = [await cliente(), numero()]
      const a = await avaliacao(c.id, n)
      await envio(a, { status: 'cancelado', tentativasMeta: 0 })
      await envio(a, { status: 'cancelado', tentativasMeta: 0 }) // várias liberadas coexistem
      const nova = await envio(a, { status: 'enviando', tentativasMeta: 0 })
      assert.equal(nova.status, 'enviando')
      await rejeita(envio(a, { status: 'enviando', tentativasMeta: 0 }), ehUnico, 'ativa duplicada')
    })

    test('16c. cancelamento COM chamada à Meta registrada continua consumindo a oportunidade', async () => {
      const casos: [string, Record<string, unknown>][] = [
        ['tentativasMeta = 1 (vindo de adiado)', { tentativasMeta: 1, erroCodigo: 130429, erroHttp: 429 }],
        ['tentativasMeta = 2', { tentativasMeta: 2 }],
        ['tentativasMeta = 1 sem erro', { tentativasMeta: 1 }],
        ['contador 0 mas com código de erro', { tentativasMeta: 0, erroCodigo: 130429 }],
        ['contador 0 mas com http de erro', { tentativasMeta: 0, erroHttp: 429 }],
      ]
      for (const [rotulo, over] of casos) {
        const [c, n] = [await cliente(), numero()]
        const a = await avaliacao(c.id, n)
        await envio(a, { status: 'cancelado', ...over })
        await rejeita(envio(a, { status: 'enviando', tentativasMeta: 0 }), ehUnico, rotulo)
      }
    })

    test('16d. CHECK: estado que implica contato com a Meta exige tentativasMeta >= 1; wamid também', async () => {
      for (const status of ['aceito', 'entregue', 'lido', 'falhou', 'incerto', 'adiado', 'rejeitado']) {
        const [c, n] = [await cliente(), numero()]
        await rejeita(envio(await avaliacao(c.id, n), { status, tentativasMeta: 0 }), ehCheck, `${status} com contador 0`)
      }
      const [c, n] = [await cliente(), numero()]
      const a = await avaliacao(c.id, n)
      await rejeita(envio(a, { status: 'cancelado', tentativasMeta: 0, wamid: 'wamid.FAKE' }), ehCheck, 'cancelado com wamid e contador 0')
      await rejeita(envio(a, { status: 'enviando', tentativasMeta: 0, wamid: 'wamid.FAKE' }), ehCheck, 'enviando com wamid e contador 0')
      await rejeita(envio(a, { status: 'enviando', tentativasMeta: -1 }), ehCheck, 'contador negativo')
      await rejeita(envio(a, { status: 'rejeitada' }), ehCheck, 'status fora do domínio')
    })

    test('16e. gatilho: tentativasMeta nunca diminui (não dá para "zerar" e cancelar para liberar a vaga)', async () => {
      const [c, n] = [await cliente(), numero()]
      const a = await avaliacao(c.id, n)
      const e = await envio(a, { status: 'adiado', tentativasMeta: 1, erroCodigo: 130429, erroHttp: 429 })
      await rejeita(
        db.recuperacaoEnvio.update({ where: { id: e.id }, data: { status: 'cancelado', tentativasMeta: 0, erroCodigo: null, erroHttp: null } }),
        ehCheck, 'zerar contador')
      // Cancelar sem zerar não libera a vaga
      await db.recuperacaoEnvio.update({ where: { id: e.id }, data: { status: 'cancelado' } })
      await rejeita(envio(a, { status: 'enviando', tentativasMeta: 0 }), ehUnico, 'após cancelar adiado')
      // Aumentar é permitido
      await db.recuperacaoEnvio.update({ where: { id: e.id }, data: { tentativasMeta: 2 } })
    })

    test('17. uma linha liberada não pode ser "revivida" enquanto existe outra ativa', async () => {
      const [c, n] = [await cliente(), numero()]
      const a = await avaliacao(c.id, n)
      const rej = await envio(a, { status: 'rejeitado' })
      const canc = await envio(a, { status: 'cancelado', tentativasMeta: 0 })
      await envio(a, { status: 'aceito', wamid: 'wamid.ATIVA' })
      await rejeita(db.recuperacaoEnvio.update({ where: { id: rej.id }, data: { status: 'enviando' } }), ehUnico, 'reviver rejeitado')
      await rejeita(db.recuperacaoEnvio.update({ where: { id: canc.id }, data: { status: 'enviando' } }), ehUnico, 'reviver cancelado')
    })

    test('17b. o ciclo natural da tentativa funciona: enviando → adiado → enviando → aceito → entregue → lido', async () => {
      const [c, n] = [await cliente(), numero()]
      const a = await avaliacao(c.id, n)
      const e = await envio(a, { status: 'enviando', tentativasMeta: 0 })
      const passos: Record<string, unknown>[] = [
        { tentativasMeta: 1 },
        { status: 'adiado', erroCodigo: 130429, erroHttp: 429 },
        { status: 'enviando', tentativasMeta: 2, erroCodigo: null, erroHttp: null },
        { status: 'aceito', wamid: 'wamid.CICLO', aceitoEm: new Date() },
        { status: 'entregue', entregueEm: new Date() },
        { status: 'lido', lidoEm: new Date() },
      ]
      for (const dados of passos) await db.recuperacaoEnvio.update({ where: { id: e.id }, data: dados })
      assert.equal((await db.recuperacaoEnvio.findUniqueOrThrow({ where: { id: e.id } })).status, 'lido')
    })

    test('18. isolamento: o mesmo número em dois clientes tem oportunidades independentes', async () => {
      const [c1, c2, n] = [await cliente(), await cliente(), numero()]
      await envio(await avaliacao(c1.id, n))
      await envio(await avaliacao(c2.id, n))
      await rejeita(envio(await avaliacao(c1.id, n, { referenciaEm: new Date('2026-12-01T10:00:00Z') })), ehUnico, 'mesmo cliente')
    })
  })

  // ═══ Retenção ══════════════════════════════════════════════════════════════
  describe('retenção da auditoria', () => {
    test('19. apagar a conversa preserva a auditoria do envio e mantém a oportunidade consumida', async () => {
      const [c, n] = [await cliente(), numero()]
      const conversa = await db.whatsappConversation.create({ data: { clienteId: c.id, numeroContato: n } })
      const a = await avaliacao(c.id, n)
      const antes = await envio(a, {
        conversaId: conversa.id, status: 'entregue', wamid: 'wamid.RET', corpo: 'Texto exato enviado',
        mensagemId: 'msg-1', aceitoEm: new Date(), entregueEm: new Date(), categoriaCobranca: 'marketing',
      })
      await db.whatsappConversation.delete({ where: { id: conversa.id } })
      const depois = await db.recuperacaoEnvio.findUniqueOrThrow({ where: { id: antes.id } })
      assert.equal(depois.conversaId, null)
      assert.deepEqual({ ...depois, conversaId: antes.conversaId, atualizadoEm: antes.atualizadoEm }, antes, 'a auditoria mudou além do vínculo')
      assert.equal(depois.corpo, 'Texto exato enviado')
      assert.equal(depois.wamid, 'wamid.RET')
      // Conversa recriada: ainda não há nova oportunidade
      await db.whatsappConversation.create({ data: { clienteId: c.id, numeroContato: n } })
      await rejeita(envio(a, { status: 'enviando', tentativasMeta: 0 }), ehUnico, 'nova tentativa após conversa recriada')
    })

    test('19b. a linha do histórico (WhatsappMessage) pode sumir sem afetar a auditoria (mensagemId sem FK)', async () => {
      const [c, n] = [await cliente(), numero()]
      const conversa = await db.whatsappConversation.create({ data: { clienteId: c.id, numeroContato: n } })
      const msg = await db.whatsappMessage.create({ data: { conversationId: conversa.id, role: 'ASSISTANT', texto: 'Oi!' } })
      const e = await envio(await avaliacao(c.id, n), { conversaId: conversa.id, mensagemId: msg.id })
      await db.whatsappMessage.delete({ where: { id: msg.id } })
      await db.recuperacaoEnvio.update({ where: { id: e.id }, data: { mensagemRemovidaEm: new Date() } })
      const depois = await db.recuperacaoEnvio.findUniqueOrThrow({ where: { id: e.id } })
      assert.equal(depois.mensagemId, msg.id)
      assert.ok(depois.mensagemRemovidaEm)
    })

    test('20. apagar o cliente remove as 5 tabelas em cascata, sem erro de FK', async () => {
      const [c, n] = [await cliente(), numero()]
      await db.recuperacaoConfig.create({ data: { clienteId: c.id } })
      await db.atividadeContato.create({ data: { clienteId: c.id, numeroContato: n, fromBruto: n, ultimaEntradaEm: new Date(), ultimoTipo: 'text' } })
      await db.recuperacaoBloqueio.create({ data: { clienteId: c.id, numeroContato: numero(), origem: 'manual' } })
      const conversa = await db.whatsappConversation.create({ data: { clienteId: c.id, numeroContato: n } })
      await envio(await avaliacao(c.id, n), { conversaId: conversa.id })
      await db.cliente.delete({ where: { id: c.id } })
      for (const t of NOVAS_TABELAS) {
        const [r] = await db.$queryRawUnsafe<{ n: bigint }[]>(`select count(*) as n from "${t}" where "clienteId" = $1`, c.id)
        assert.equal(Number(r.n), 0, `${t} deveria ter sido apagada em cascata`)
      }
    })

    test('20b. apagar uma avaliação que já tem envio é recusado (auditoria protegida)', async () => {
      const [c, n] = [await cliente(), numero()]
      const a = await avaliacao(c.id, n)
      await envio(a)
      await rejeita(db.recuperacaoAvaliacao.delete({ where: { id: a.id } }), ehFk, 'apagar avaliação com envio')
    })
  })

  // Espera por uma condição com prazo (sem dormir um tempo fixo às cegas).
  async function esperarPor(cond: () => Promise<boolean>, msg: string, ms = 8000) {
    const fim = Date.now() + ms
    while (Date.now() < fim) {
      if (await cond()) return
      await new Promise((r) => setTimeout(r, 25))
    }
    assert.fail(`${msg} (prazo de ${ms} ms esgotado)`)
  }
})
