import Link from 'next/link'
import { redirect } from 'next/navigation'
import { isAdminAuthed } from '@/lib/admin/guard'
import { prisma } from '@/lib/prisma'
import type { CampoPedido, CanaisFallback } from '@/lib/admin/cadastro'
import LogoutButton from '../../LogoutButton'
import CadastroForm from '../CadastroForm'

export const dynamic = 'force-dynamic'

function statusLabel(s: string): string {
  if (s === 'ativo') return 'Ativo'
  if (s === 'manutencao') return 'Em manutenção'
  if (s === 'prospect') return 'Prospect'
  return s
}

export default async function CadastroClientePage({
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
    select: {
      id: true,
      nomeNegocio: true,
      cerebro: true,
      status: true,
      modo: true,
      camposPedido: true,
      emailPrestador: true,
      nomeRemetente: true,
      destinoEncaminhamento: true,
      canaisFallback: true,
      phoneNumberId: true,
      wabaId: true,
      numeroExibicao: true,
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

        {!cliente ? (
          <>
            <h1>Cliente não encontrado</h1>
            <div className="card">
              <p className="muted">
                Nenhum cliente com o id <code>{id}</code>. Pode ter sido removido ou o link está
                errado.
              </p>
            </div>
          </>
        ) : (
          <>
            <h1>Cadastro · {cliente.nomeNegocio}</h1>
            <p className="muted breadcrumb">Status: {statusLabel(cliente.status)}</p>
            <CadastroForm
              id={cliente.id}
              status={cliente.status}
              phoneNumberIdSalvo={cliente.phoneNumberId}
              inicial={{
                nomeNegocio: cliente.nomeNegocio,
                cerebro: JSON.stringify(cliente.cerebro, null, 2),
                modo: cliente.modo ?? '',
                camposPedido: Array.isArray(cliente.camposPedido)
                  ? (cliente.camposPedido as CampoPedido[])
                  : [],
                emailPrestador: cliente.emailPrestador,
                nomeRemetente: cliente.nomeRemetente ?? '',
                destinoEncaminhamento: cliente.destinoEncaminhamento,
                canaisFallback: {
                  principal: { tipo: 'email', contato: '' },
                  ...((cliente.canaisFallback ?? {}) as CanaisFallback),
                },
                phoneNumberId: cliente.phoneNumberId ?? '',
                wabaId: cliente.wabaId ?? '',
                numeroExibicao: cliente.numeroExibicao ?? '',
              }}
            />
          </>
        )}
      </div>
    </>
  )
}
