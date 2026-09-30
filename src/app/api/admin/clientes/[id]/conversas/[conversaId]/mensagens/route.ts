import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isAdminAuthed } from '@/lib/admin/guard'

const PAGE_SIZE = 30

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; conversaId: string }> },
) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { id, conversaId } = await ctx.params

  const conversa = await prisma.whatsappConversation.findUnique({
    where: { id: conversaId },
    select: { id: true, clienteId: true },
  })
  if (!conversa || conversa.clienteId !== id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const url = new URL(req.url)
  const before = url.searchParams.get('before')

  if (!before) {
    return NextResponse.json(
      { error: 'invalid_query', message: 'Parâmetro "before" é obrigatório.' },
      { status: 400 },
    )
  }

  const cursor = await prisma.whatsappMessage.findUnique({
    where: { id: before },
    select: { id: true, conversationId: true, createdAt: true },
  })
  if (!cursor || cursor.conversationId !== conversaId) {
    return NextResponse.json({ error: 'invalid_cursor' }, { status: 400 })
  }

  const anterioresDesc = await prisma.whatsappMessage.findMany({
    where: {
      conversationId: conversaId,
      OR: [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ],
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: PAGE_SIZE + 1,
    select: { id: true, role: true, texto: true, createdAt: true },
  })

  const hasMore = anterioresDesc.length > PAGE_SIZE
  const lote = (hasMore ? anterioresDesc.slice(0, PAGE_SIZE) : anterioresDesc)
    .slice()
    .reverse()

  return NextResponse.json({
    mensagens: lote.map((m) => ({
      id: m.id,
      role: m.role,
      texto: m.texto,
      createdAt: m.createdAt.toISOString(),
    })),
    hasMore,
  })
}
