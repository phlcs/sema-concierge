import Link from 'next/link'
import { redirect } from 'next/navigation'
import { isAdminAuthed } from '@/lib/admin/guard'
import { prisma } from '@/lib/prisma'
import LogoutButton from '../LogoutButton'
import StatusToggle from './StatusToggle'
import InterruptorGeral from './InterruptorGeral'
import { lerInterruptor } from '@/lib/admin/interruptor'

export const dynamic = 'force-dynamic'

function statusLabel(s: string): { label: string; dot: string } {
  if (s === 'ativo') return { label: 'Ativo', dot: 'dot ativo' }
  if (s === 'manutencao') return { label: 'Em manutenção', dot: 'dot manutencao' }
  return { label: s, dot: 'dot outro' }
}

export default async function ClientesPage() {
  if (!(await isAdminAuthed())) {
    redirect('/admin/login')
  }

  const clientes = await prisma.cliente.findMany({
    orderBy: { nomeNegocio: 'asc' },
    select: {
      id: true,
      nomeNegocio: true,
      emailPrestador: true,
      status: true,
    },
  })

  const interruptor = await lerInterruptor()
  const ligadoEm = interruptor.ligadoEm
    ? new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(interruptor.ligadoEm)
    : null

  return (
    <>
      <div className="topbar">
        <span className="brand">
          <Link href="/admin">Painel Sema</Link>
        </span>
        <LogoutButton />
      </div>
      <div className="shell">
        <p className="muted breadcrumb">
          <Link href="/admin">← Voltar</Link>
        </p>
        <h1>Clientes</h1>

        <InterruptorGeral
          ligado={interruptor.ligado}
          ligadoEm={ligadoEm}
          afetados={interruptor.afetados}
        />

        {clientes.length === 0 ? (
          <div className="card">
            <p className="muted">Nenhum cliente cadastrado ainda.</p>
          </div>
        ) : (
          <div className="card table-card">
            <table className="clientes-table">
              <thead>
                <tr>
                  <th>Negócio</th>
                  <th>E-mail do prestador</th>
                  <th>Status</th>
                  <th className="col-acao">Conversas</th>
                  <th className="col-acao">Cérebro</th>
                  <th className="col-acao">Ação</th>
                </tr>
              </thead>
              <tbody>
                {clientes.map((c) => {
                  const s = statusLabel(c.status)
                  return (
                    <tr key={c.id}>
                      <td>{c.nomeNegocio}</td>
                      <td className="muted">{c.emailPrestador}</td>
                      <td>
                        <span className="status-cell">
                          <span className={s.dot} aria-hidden />
                          {s.label}
                        </span>
                      </td>
                      <td className="col-acao">
                        <Link className="link-action" href={`/admin/clientes/${c.id}/conversas`}>
                          Ver conversas
                        </Link>
                      </td>
                      <td className="col-acao">
                        <Link className="link-action" href={`/admin/clientes/${c.id}/cerebro`}>
                          Editar cérebro
                        </Link>
                      </td>
                      <td className="col-acao">
                        <StatusToggle
                          id={c.id}
                          nomeNegocio={c.nomeNegocio}
                          status={c.status}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
