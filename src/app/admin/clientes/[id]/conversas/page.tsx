import Link from 'next/link'
import { redirect } from 'next/navigation'
import { isAdminAuthed } from '@/lib/admin/guard'
import { prisma } from '@/lib/prisma'
import LogoutButton from '../../../LogoutButton'

export const dynamic = 'force-dynamic'

const fmt = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
})

export default async function ConversasPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  if (!(await isAdminAuthed())) {
    redirect('/admin/login')
  }

  const { id } = await params

  const cliente = await prisma.cliente.findUnique({
    where: { id },
    select: { id: true, nomeNegocio: true },
  })

  if (!cliente) {
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
            <Link href="/admin/clientes">← Voltar para clientes</Link>
          </p>
          <h1>Cliente não encontrado</h1>
          <div className="card">
            <p className="muted">
              Nenhum cliente com o id <code>{id}</code>.
            </p>
          </div>
        </div>
      </>
    )
  }

  const conversas = await prisma.whatsappConversation.findMany({
    where: { clienteId: id },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      numeroContato: true,
      handoffEm: true,
      revisar: true,
      updatedAt: true,
    },
  })

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
          <Link href="/admin/clientes">← Voltar para clientes</Link>
        </p>
        <h1>Conversas · {cliente.nomeNegocio}</h1>

        {conversas.length === 0 ? (
          <div className="card">
            <p className="muted">Nenhuma conversa ainda.</p>
          </div>
        ) : (
          <div className="card table-card">
            <table className="clientes-table">
              <thead>
                <tr>
                  <th>Contato</th>
                  <th>Última atividade</th>
                  <th className="col-acao">Status</th>
                </tr>
              </thead>
              <tbody>
                {conversas.map((c) => (
                  <tr
                    key={c.id}
                    className={c.revisar ? 'row-revisar' : undefined}
                  >
                    <td>
                      <Link
                        className="link-action"
                        href={`/admin/clientes/${id}/conversas/${c.id}`}
                      >
                        {c.numeroContato}
                      </Link>
                    </td>
                    <td className="muted">{fmt.format(c.updatedAt)}</td>
                    <td className="col-acao">
                      <span className="badge-row">
                        {c.revisar && (
                          <span className="badge badge-revisar">Revisar</span>
                        )}
                        {c.handoffEm && (
                          <span className="badge badge-handoff">Handoff</span>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
