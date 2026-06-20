import Link from 'next/link'
import { redirect } from 'next/navigation'
import { isAdminAuthed } from '@/lib/admin/guard'
import { prisma } from '@/lib/prisma'
import LogoutButton from '../../../../LogoutButton'
import MessagesReader, { type MensagemDTO } from './MessagesReader'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 30

const fmtCabecalho = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
})

export default async function ConversaPage({
  params,
}: {
  params: Promise<{ id: string; conversaId: string }>
}) {
  if (!(await isAdminAuthed())) {
    redirect('/admin/login')
  }

  const { id, conversaId } = await params

  const conversa = await prisma.whatsappConversation.findUnique({
    where: { id: conversaId },
    select: {
      id: true,
      clienteId: true,
      numeroContato: true,
      handoffEm: true,
      revisar: true,
      cliente: { select: { nomeNegocio: true } },
    },
  })

  const naoEncontrada = !conversa || conversa.clienteId !== id

  if (naoEncontrada) {
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
            <Link href={`/admin/clientes/${id}/conversas`}>← Voltar</Link>
          </p>
          <h1>Conversa não encontrada</h1>
          <div className="card">
            <p className="muted">
              A conversa solicitada não existe ou não pertence a este cliente.
            </p>
          </div>
        </div>
      </>
    )
  }

  const ultimasDesc = await prisma.whatsappMessage.findMany({
    where: { conversationId: conversaId },
    orderBy: { createdAt: 'desc' },
    take: PAGE_SIZE + 1,
    select: { id: true, role: true, texto: true, createdAt: true },
  })

  const hasMore = ultimasDesc.length > PAGE_SIZE
  const lote = (hasMore ? ultimasDesc.slice(0, PAGE_SIZE) : ultimasDesc)
    .slice()
    .reverse()

  const mensagensIniciais: MensagemDTO[] = lote.map((m) => ({
    id: m.id,
    role: m.role,
    texto: m.texto,
    createdAt: m.createdAt.toISOString(),
  }))

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
          <Link href={`/admin/clientes/${id}/conversas`}>
            ← Voltar para conversas
          </Link>
        </p>
        <h1>{conversa.numeroContato}</h1>
        <p className="muted">
          {conversa.cliente.nomeNegocio}
          {conversa.handoffEm && (
            <>
              {' · '}
              Handoff em {fmtCabecalho.format(conversa.handoffEm)}
            </>
          )}
          {conversa.revisar && (
            <>
              {' · '}
              <span className="badge badge-revisar">Revisar</span>
            </>
          )}
        </p>

        <MessagesReader
          clienteId={id}
          conversaId={conversaId}
          mensagensIniciais={mensagensIniciais}
          temMaisInicial={hasMore}
        />
      </div>
    </>
  )
}
