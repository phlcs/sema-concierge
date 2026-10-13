import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { registrarEvento, resumoErro } from '@/lib/eventos'
import { resumirConversa } from '@/lib/ai/resumir'
import type { ContextoRegistro } from '@/lib/ai/registro'
import { LIMITE_HISTORICO } from '@/lib/whatsapp/conversa'

// Resumo de conversa longa (T11). Quando a conversa passa da janela de histórico
// (LIMITE_HISTORICO), as mensagens que saíram viram um resumo acumulativo guardado
// na conversa, que entra no prompt junto com a janela. Gerado depois de a resposta
// sair, vale a partir da mensagem seguinte.

// Mensagens resumidas por chamada. Conversa antiga com mais que isso fora da janela
// é resumida aos poucos, um bloco por turno, da mais antiga para a mais nova.
const TETO_POR_RESUMO = 200

type MensagemSalva = { role: 'USER' | 'ASSISTANT'; texto: string; createdAt: Date }

// Lado de cada porta: onde ler as mensagens e onde guardar o resumo
type FonteResumo = {
  lerResumo: () => Promise<{ resumo: string | null; resumoAte: Date | null }>
  // Mensagens depois de `depois` e até `ate` (quando houver), na ordem pedida
  listarMensagens: (args: {
    depois: Date | null
    ate?: Date
    ordem: 'asc' | 'desc'
    pular: number
    pegar: number
  }) => Promise<MensagemSalva[]>
  // Grava só se ninguém gravou outro resumo desde `anterior`; devolve se gravou
  salvarResumo: (args: { resumo: string; resumoAte: Date; anterior: Date | null }) => Promise<boolean>
}

async function atualizarResumo(fonte: FonteResumo, contexto: ContextoRegistro): Promise<void> {
  try {
    const { resumo, resumoAte } = await fonte.lerResumo()

    // Corte: a mensagem mais nova que já está fora da janela
    const [corte] = await fonte.listarMensagens({
      depois: resumoAte,
      ordem: 'desc',
      pular: LIMITE_HISTORICO,
      pegar: 1,
    })
    if (!corte) return

    const mensagens = await fonte.listarMensagens({
      depois: resumoAte,
      ate: corte.createdAt,
      ordem: 'asc',
      pular: 0,
      pegar: TETO_POR_RESUMO,
    })
    if (mensagens.length === 0) return

    const novo = await resumirConversa({
      resumoAnterior: resumo,
      mensagens: mensagens.map((m) => ({
        role: m.role === 'USER' ? ('user' as const) : ('assistant' as const),
        texto: m.texto,
      })),
      contexto,
    })
    const gravou = await fonte.salvarResumo({
      resumo: novo,
      resumoAte: mensagens[mensagens.length - 1].createdAt,
      anterior: resumoAte,
    })
    logger.info('resumo: conversa resumida', {
      origem: contexto.origem,
      conversaId: contexto.conversaId ?? null,
      mensagens: mensagens.length,
      gravou,
    })
  } catch (err) {
    // O texto da conversa nunca vai para o log nem para o evento
    logger.error('resumo: falha ao gerar o resumo da conversa', {
      origem: contexto.origem,
      conversaId: contexto.conversaId ?? null,
      erro: err instanceof Error ? err.message.slice(0, 300) : String(err),
    })
    await registrarEvento('resumo_falha', {
      clienteId: contexto.clienteId,
      detalhe: {
        origem: contexto.origem,
        conversaId: contexto.conversaId ?? null,
        demoId: contexto.demoId ?? null,
        ...resumoErro(err),
      },
    })
  }
}

function filtroData(depois: Date | null, ate?: Date) {
  if (!depois && !ate) return {}
  return { createdAt: { ...(depois ? { gt: depois } : {}), ...(ate ? { lte: ate } : {}) } }
}

// --- WhatsApp: resumo na própria conversa ---

export async function carregarResumoWhatsapp(conversaId: string): Promise<string | null> {
  const c = await prisma.whatsappConversation.findUnique({
    where: { id: conversaId },
    select: { resumo: true },
  })
  return c?.resumo ?? null
}

// Nunca lança: falha vira evento "resumo_falha"
export async function atualizarResumoWhatsapp(
  conversaId: string,
  contexto: ContextoRegistro,
): Promise<void> {
  await atualizarResumo(
    {
      lerResumo: async () => {
        const c = await prisma.whatsappConversation.findUnique({
          where: { id: conversaId },
          select: { resumo: true, resumoAte: true },
        })
        return { resumo: c?.resumo ?? null, resumoAte: c?.resumoAte ?? null }
      },
      listarMensagens: ({ depois, ate, ordem, pular, pegar }) =>
        prisma.whatsappMessage.findMany({
          where: { conversationId: conversaId, ...filtroData(depois, ate) },
          orderBy: { createdAt: ordem },
          skip: pular,
          take: pegar,
          select: { role: true, texto: true, createdAt: true },
        }),
      salvarResumo: async ({ resumo, resumoAte, anterior }) => {
        const r = await prisma.whatsappConversation.updateMany({
          where: { id: conversaId, resumoAte: anterior },
          data: { resumo, resumoAte },
        })
        return r.count > 0
      },
    },
    contexto,
  )
}

// --- Link de teste: resumo por sessão, na tabela DemoResumo ---

export async function carregarResumoDemo(clienteId: string, sessaoId: string): Promise<string | null> {
  const r = await prisma.demoResumo.findUnique({
    where: { clienteId_sessaoId: { clienteId, sessaoId } },
    select: { resumo: true },
  })
  return r?.resumo ?? null
}

// Nunca lança: falha vira evento "resumo_falha"
export async function atualizarResumoDemo(
  clienteId: string,
  sessaoId: string,
  contexto: ContextoRegistro,
): Promise<void> {
  await atualizarResumo(
    {
      lerResumo: async () => {
        const r = await prisma.demoResumo.findUnique({
          where: { clienteId_sessaoId: { clienteId, sessaoId } },
          select: { resumo: true, resumoAte: true },
        })
        return { resumo: r?.resumo ?? null, resumoAte: r?.resumoAte ?? null }
      },
      listarMensagens: ({ depois, ate, ordem, pular, pegar }) =>
        prisma.demoMensagem.findMany({
          where: { clienteId, sessaoId, ...filtroData(depois, ate) },
          orderBy: { createdAt: ordem },
          skip: pular,
          take: pegar,
          select: { role: true, texto: true, createdAt: true },
        }),
      salvarResumo: async ({ resumo, resumoAte, anterior }) => {
        if (!anterior) {
          try {
            await prisma.demoResumo.create({ data: { clienteId, sessaoId, resumo, resumoAte } })
            return true
          } catch (err) {
            // Outro turno criou o resumo da sessão antes: fica o dele
            if ((err as { code?: string }).code === 'P2002') return false
            throw err
          }
        }
        const r = await prisma.demoResumo.updateMany({
          where: { clienteId, sessaoId, resumoAte: anterior },
          data: { resumo, resumoAte },
        })
        return r.count > 0
      },
    },
    contexto,
  )
}
