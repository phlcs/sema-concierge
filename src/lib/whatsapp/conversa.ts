import { prisma } from '@/lib/prisma'

export type HistoryMessage = { role: 'user' | 'assistant'; content: string; createdAt?: Date }

export async function acharOuCriarConversa(
  clienteId: string,
  numeroContato: string,
): Promise<{ conversaId: string; ehPrimeiraMensagem: boolean }> {
  const existente = await prisma.whatsappConversation.findUnique({
    where: { clienteId_numeroContato: { clienteId, numeroContato } },
  })

  if (existente) {
    const count = await prisma.whatsappMessage.count({
      where: { conversationId: existente.id },
    })
    return { conversaId: existente.id, ehPrimeiraMensagem: count === 0 }
  }

  const criada = await prisma.whatsappConversation.create({
    data: { clienteId, numeroContato },
  })
  return { conversaId: criada.id, ehPrimeiraMensagem: true }
}

// Teto de mensagens enviadas ao modelo como histórico
export const LIMITE_HISTORICO = 40

export async function carregarHistorico(conversationId: string): Promise<HistoryMessage[]> {
  const msgs = await prisma.whatsappMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: LIMITE_HISTORICO,
  })
  return msgs.reverse().map((m) => ({
    role: m.role === 'USER' ? ('user' as const) : ('assistant' as const),
    content: m.texto,
    createdAt: m.createdAt,
  }))
}

export async function salvarMensagem(
  conversationId: string,
  role: 'USER' | 'ASSISTANT',
  texto: string,
): Promise<void> {
  await prisma.whatsappMessage.create({
    data: { conversationId, role, texto },
  })
  await prisma.whatsappConversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  })
}
