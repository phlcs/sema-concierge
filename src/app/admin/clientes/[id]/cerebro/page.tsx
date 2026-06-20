import Link from 'next/link'
import { redirect } from 'next/navigation'
import { isAdminAuthed } from '@/lib/admin/guard'
import { prisma } from '@/lib/prisma'
import LogoutButton from '../../../LogoutButton'
import CerebroEditor from './CerebroEditor'

export const dynamic = 'force-dynamic'

export default async function CerebroPage({
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
    select: { id: true, nomeNegocio: true, cerebro: true },
  })

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
          <Link href="/admin/clientes">← Voltar para clientes</Link>
        </p>

        {!cliente ? (
          <>
            <h1>Cliente não encontrado</h1>
            <div className="card">
              <p className="muted">
                Nenhum cliente com o id <code>{id}</code>. Pode ter sido removido
                ou o link está errado.
              </p>
            </div>
          </>
        ) : (
          <>
            <h1>Cérebro · {cliente.nomeNegocio}</h1>
            <p className="muted breadcrumb">
              Edite o JSON do cérebro do bot. O painel da esquerda mostra o que
              está em produção agora; o da direita é o seu rascunho.
            </p>
            <CerebroEditor
              id={cliente.id}
              nomeNegocio={cliente.nomeNegocio}
              cerebroAtual={JSON.stringify(cliente.cerebro, null, 2)}
            />
          </>
        )}
      </div>
    </>
  )
}
