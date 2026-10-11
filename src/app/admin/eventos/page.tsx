import Link from 'next/link'
import { redirect } from 'next/navigation'
import { isAdminAuthed } from '@/lib/admin/guard'
import { prisma } from '@/lib/prisma'
import { GRAVIDADES, TEMAS, type Gravidade, type Tema } from '@/lib/eventos'
import type { Prisma } from '@/generated/prisma/client'
import LogoutButton from '../LogoutButton'

export const dynamic = 'force-dynamic'

const POR_PAGINA = 100
const FORMATO_DATA = /^\d{4}-\d{2}-\d{2}$/

type Busca = { tema?: string; gravidade?: string; cliente?: string; de?: string; ate?: string; pagina?: string }

const formatoDataHora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  dateStyle: 'short',
  timeStyle: 'medium',
})

// Brasília não tem horário de verão desde 2019: o dia vai de 00:00 a 24:00 em UTC-3
function inicioDoDia(dia: string): Date | null {
  if (!FORMATO_DATA.test(dia)) return null
  const d = new Date(`${dia}T00:00:00-03:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

function detalheEmTexto(detalhe: unknown): string {
  if (!detalhe || typeof detalhe !== 'object' || Array.isArray(detalhe)) return ''
  return Object.entries(detalhe as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(' · ')
}

function classeGravidade(g: string): string {
  if (g === 'Erro') return 'dot erro'
  if (g === 'Aviso') return 'dot manutencao'
  return 'dot outro'
}

function linkPagina(busca: Busca, pagina: number): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries({ ...busca, pagina: String(pagina) })) {
    if (v) params.set(k, v)
  }
  return `/admin/eventos?${params.toString()}`
}

export default async function EventosPage({ searchParams }: { searchParams: Promise<Busca> }) {
  if (!(await isAdminAuthed())) {
    redirect('/admin/login')
  }

  const busca = await searchParams
  const tema = TEMAS.includes(busca.tema as Tema) ? (busca.tema as Tema) : ''
  const gravidade = GRAVIDADES.includes(busca.gravidade as Gravidade)
    ? (busca.gravidade as Gravidade)
    : ''
  const clienteId = busca.cliente ?? ''
  const de = busca.de && inicioDoDia(busca.de) ? busca.de : ''
  const ate = busca.ate && inicioDoDia(busca.ate) ? busca.ate : ''
  const pagina = Math.max(1, Math.floor(Number(busca.pagina)) || 1)

  const where: Prisma.EventoWhereInput = {
    ...(tema ? { tema } : {}),
    ...(gravidade ? { gravidade } : {}),
    ...(clienteId ? { clienteId } : {}),
  }
  const inicio = de ? inicioDoDia(de) : null
  const fim = ate ? new Date((inicioDoDia(ate) as Date).getTime() + 24 * 60 * 60 * 1000) : null
  if (inicio || fim) {
    where.createdAt = { ...(inicio ? { gte: inicio } : {}), ...(fim ? { lt: fim } : {}) }
  }

  const [clientes, eventos] = await Promise.all([
    prisma.cliente.findMany({ orderBy: { nomeNegocio: 'asc' }, select: { id: true, nomeNegocio: true } }),
    prisma.evento.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (pagina - 1) * POR_PAGINA,
      take: POR_PAGINA + 1,
    }),
  ])
  const temMais = eventos.length > POR_PAGINA
  const linhas = eventos.slice(0, POR_PAGINA)
  const nomePorId = new Map(clientes.map((c) => [c.id, c.nomeNegocio]))
  const filtrosAtuais: Busca = { tema, gravidade, cliente: clienteId, de, ate }

  return (
    <>
      <div className="topbar">
        <span className="brand">
          <Link href="/admin">Painel Sema</Link>
        </span>
        <LogoutButton />
      </div>
      <div className="shell shell-wide">
        <p className="muted breadcrumb">
          <Link href="/admin">← Voltar</Link>
        </p>
        <h1>Eventos</h1>

        <form method="get" action="/admin/eventos" className="card filtros">
          <div className="field">
            <label htmlFor="tema">Tema</label>
            <select id="tema" name="tema" defaultValue={tema}>
              <option value="">Todos</option>
              {TEMAS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="gravidade">Gravidade</label>
            <select id="gravidade" name="gravidade" defaultValue={gravidade}>
              <option value="">Todas</option>
              {GRAVIDADES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="cliente">Cliente</label>
            <select id="cliente" name="cliente" defaultValue={clienteId}>
              <option value="">Todos</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nomeNegocio}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="de">De</label>
            <input id="de" name="de" type="date" defaultValue={de} />
          </div>
          <div className="field">
            <label htmlFor="ate">Até</label>
            <input id="ate" name="ate" type="date" defaultValue={ate} />
          </div>
          <div className="filtros-acoes">
            <button type="submit">Filtrar</button>
            <Link className="link-action" href="/admin/eventos">
              Limpar
            </Link>
          </div>
        </form>

        {linhas.length === 0 ? (
          <div className="card">
            <p className="muted">Nenhum evento encontrado com esses filtros.</p>
          </div>
        ) : (
          <div className="card table-card">
            <table className="clientes-table eventos-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Cliente</th>
                  <th>Tema</th>
                  <th>Gravidade</th>
                  <th>Evento</th>
                  <th>Detalhe</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((e) => (
                  <tr key={e.id}>
                    <td className="col-acao">{formatoDataHora.format(e.createdAt)}</td>
                    <td>{e.clienteId ? (nomePorId.get(e.clienteId) ?? 'Cliente removido') : '—'}</td>
                    <td>{e.tema}</td>
                    <td>
                      <span className="status-cell">
                        <span className={classeGravidade(e.gravidade)} aria-hidden />
                        {e.gravidade}
                      </span>
                    </td>
                    <td>{e.evento}</td>
                    <td className="muted detalhe-evento">{detalheEmTexto(e.detalhe)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pagina > 1 || temMais ? (
          <p className="muted paginacao">
            {pagina > 1 ? <Link href={linkPagina(filtrosAtuais, pagina - 1)}>← Mais recentes</Link> : null}
            <span>Página {pagina}</span>
            {temMais ? <Link href={linkPagina(filtrosAtuais, pagina + 1)}>Mais antigos →</Link> : null}
          </p>
        ) : null}
      </div>
    </>
  )
}
