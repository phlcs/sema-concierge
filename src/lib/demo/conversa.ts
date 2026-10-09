import { prisma } from '@/lib/prisma'
import type { HistoryMessage } from '@/lib/atendimento/motor'
import { LIMITE_HISTORICO } from '@/lib/whatsapp/conversa'

// Limite próprio da demo (o WhatsApp usa LIMITE_MENSAGEM, por mensagem do turno)
export const LIMITE_CARACTERES = 500

export const MSG_LONGA = `Mensagem muito longa. Tente resumir em até ${LIMITE_CARACTERES} caracteres.`
export const MSG_TETO =
  'Esta demonstração atingiu o limite de mensagens. Fale com a Sema para continuar.'

export type MensagemTela = { role: 'user' | 'assistant'; texto: string; hora: string }

const formatoHora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  hour: '2-digit',
  minute: '2-digit',
})

export function formatarHora(data: Date): string {
  return formatoHora.format(data)
}

// Mesmo formato do carregarHistorico do WhatsApp: últimas LIMITE_HISTORICO, em ordem cronológica
export async function carregarHistoricoDemo(
  demoId: string,
  sessaoId: string,
): Promise<HistoryMessage[]> {
  const msgs = await prisma.demoMensagem.findMany({
    where: { demoId, sessaoId },
    orderBy: { createdAt: 'desc' },
    take: LIMITE_HISTORICO,
    select: { role: true, texto: true, createdAt: true },
  })
  return msgs.reverse().map((m) => ({
    role: m.role === 'USER' ? ('user' as const) : ('assistant' as const),
    content: m.texto,
    createdAt: m.createdAt,
  }))
}

export async function listarMensagensSessao(
  demoId: string,
  sessaoId: string,
): Promise<MensagemTela[]> {
  const msgs = await prisma.demoMensagem.findMany({
    where: { demoId, sessaoId },
    orderBy: { createdAt: 'asc' },
    select: { role: true, texto: true, createdAt: true },
  })
  return msgs.map((m) => ({
    role: m.role === 'USER' ? 'user' : 'assistant',
    texto: m.texto,
    hora: formatarHora(m.createdAt),
  }))
}

export async function contarMensagensUsuario(demoId: string): Promise<number> {
  return prisma.demoMensagem.count({ where: { demoId, role: 'USER' } })
}

export async function contarMensagensSessao(demoId: string, sessaoId: string): Promise<number> {
  return prisma.demoMensagem.count({ where: { demoId, sessaoId } })
}

export async function salvarMensagemDemo(args: {
  demoId: string
  sessaoId: string
  role: 'USER' | 'ASSISTANT'
  texto: string
  createdAt: Date
  handoff?: { leadNome: string | null; leadIntencao: string | null; leadResumo: string | null }
}): Promise<void> {
  const { handoff, ...dados } = args
  await prisma.demoMensagem.create({
    data: handoff ? { ...dados, handoff: true, ...handoff } : dados,
  })
}

export type HandoffSalvo = {
  leadNome: string | null
  leadIntencao: string | null
  leadResumo: string | null
  createdAt: Date
}

// Máximo 1 handoff por sessão: devolve o primeiro, se houver
export async function buscarHandoffSessao(
  demoId: string,
  sessaoId: string,
): Promise<HandoffSalvo | null> {
  return prisma.demoMensagem.findFirst({
    where: { demoId, sessaoId, handoff: true },
    orderBy: { createdAt: 'asc' },
    select: { leadNome: true, leadIntencao: true, leadResumo: true, createdAt: true },
  })
}
