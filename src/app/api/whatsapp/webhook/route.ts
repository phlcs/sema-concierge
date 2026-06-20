import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { enviarTexto } from '@/lib/whatsapp/send'
import { chatComplete } from '@/lib/ai'
import { validateInput } from '@/lib/ai/validate-input'
import { buildPrestadorPrompt } from '@/lib/ai/build-prestador-prompt'
import {
  BLOCKED_RESPONSE,
  FALLBACK_RESPONSE,
  MAINTENANCE_RESPONSE,
  type AiResponse,
} from '@/lib/ai/schema'
import { normalizarNumero } from '@/lib/whatsapp/phone'
import {
  acharOuCriarConversa,
  carregarHistorico,
  salvarMensagem,
} from '@/lib/whatsapp/conversa'
import { resend } from '@/lib/integrations/resend'
import { precisaRevisar } from '@/lib/qa/keywords'

const HANDOFF_COOLDOWN_MS = 24 * 60 * 60 * 1000

const INSTRUCAO_CONTINUACAO =
  '\n\n# CONTINUAÇÃO DE CONVERSA\nEsta conversa JÁ ESTÁ em andamento com este cliente. NÃO se reapresente, NÃO repita a saudação inicial e NÃO pergunte o nome de novo se já souber. Responda direto, dando continuidade ao que já foi conversado.\n'

function renderResposta(resposta: AiResponse): string {
  const paragrafos = (resposta.paragraphs ?? []).map((p) => p.trim()).filter(Boolean)
  if (paragrafos.length === 0) return FALLBACK_RESPONSE.paragraphs.join('\n\n')
  return paragrafos.join('\n\n')
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const mode = searchParams.get('hub.mode')
  const verifyToken = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode === 'subscribe' && verifyToken === process.env.VERIFY_TOKEN) {
    return new NextResponse(challenge ?? '', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }
  return new NextResponse('Forbidden', { status: 403 })
}

type MetaMessage = {
  from?: string
  type?: string
  text?: { body?: string }
}

type MetaChange = {
  field?: string
  value?: {
    metadata?: { phone_number_id?: string }
    messages?: MetaMessage[]
  }
}

type MetaEntry = { changes?: MetaChange[] }
type MetaBody = { entry?: MetaEntry[] }

export async function POST(req: NextRequest) {
  let body: MetaBody
  try {
    body = (await req.json()) as MetaBody
  } catch {
    return NextResponse.json({ ok: true })
  }

  processar(body).catch((err) => {
    logger.error('erro processando webhook do WhatsApp', {
      erro: err instanceof Error ? err.message : String(err),
    })
  })

  return NextResponse.json({ ok: true })
}

async function processar(body: MetaBody): Promise<void> {
  const entries = body.entry ?? []
  for (const entry of entries) {
    const changes = entry.changes ?? []
    for (const change of changes) {
      if (change.field !== 'messages') continue
      const value = change.value
      if (!value) continue
      const phoneNumberId = value.metadata?.phone_number_id
      if (!phoneNumberId) continue

      const messages = value.messages ?? []
      for (const message of messages) {
        if (message.type !== 'text') continue
        const texto = message.text?.body
        const deNumero = message.from
        if (!texto || !deNumero) continue

        await tratarMensagem({ phoneNumberId, deNumero, texto })
      }
    }
  }
}

async function tratarMensagem(args: {
  phoneNumberId: string
  deNumero: string
  texto: string
}): Promise<void> {
  const { phoneNumberId, deNumero, texto } = args

  const cliente = await prisma.cliente.findUnique({ where: { phoneNumberId } })

  if (!cliente) {
    logger.warn(`cliente não encontrado para phone_number_id: ${phoneNumberId}`)
    return
  }

  if (cliente.status === 'manutencao') {
    const numeroContato = normalizarNumero(deNumero)
    const { conversaId } = await acharOuCriarConversa(cliente.id, numeroContato)
    const mensagem = renderResposta(MAINTENANCE_RESPONSE)

    await salvarMensagem(conversaId, 'USER', texto)
    await salvarMensagem(conversaId, 'ASSISTANT', mensagem)

    await enviarTexto({
      token: process.env.WHATSAPP_TOKEN ?? '',
      phoneNumberId: cliente.phoneNumberId,
      para: deNumero,
      mensagem,
    })

    logger.info('cliente em manutencao, auto-reply enviado', { phoneNumberId })
    return
  }

  if (cliente.status !== 'ativo') {
    logger.warn('cliente inativo', { phoneNumberId })
    return
  }

  const numeroContato = normalizarNumero(deNumero)
  const { conversaId, ehPrimeiraMensagem } = await acharOuCriarConversa(
    cliente.id,
    numeroContato,
  )

  const inputCheck = validateInput(texto)
  let mensagem: string
  let aiResponse: AiResponse = BLOCKED_RESPONSE
  if (!inputCheck.ok) {
    logger.warn('webhook: entrada bloqueada por validateInput', {
      phoneNumberId,
      reason: inputCheck.reason,
    })
    mensagem = renderResposta(BLOCKED_RESPONSE)
  } else {
    const history = await carregarHistorico(conversaId)
    let systemPrompt = buildPrestadorPrompt(cliente.cerebro)
    if (!ehPrimeiraMensagem) systemPrompt += INSTRUCAO_CONTINUACAO

    try {
      aiResponse = await chatComplete({ systemPrompt, history, userMessage: texto })
    } catch (err) {
      logger.error('webhook: chatComplete falhou', {
        erro: err instanceof Error ? err.message : String(err),
      })
      aiResponse = FALLBACK_RESPONSE
    }
    mensagem = renderResposta(aiResponse)
  }

  await salvarMensagem(conversaId, 'USER', texto)
  await salvarMensagem(conversaId, 'ASSISTANT', mensagem)

  await enviarTexto({
    token: process.env.WHATSAPP_TOKEN ?? '',
    phoneNumberId: cliente.phoneNumberId,
    para: deNumero,
    mensagem,
  })

  try {
    if (precisaRevisar(texto) || precisaRevisar(mensagem)) {
      await prisma.whatsappConversation.update({
        where: { id: conversaId },
        data: { revisar: true },
      })
      logger.info('conversa marcada pra revisão', { conversaId })
    }
  } catch (err) {
    logger.error('webhook: erro ao marcar conversa para revisão', {
      erro: err instanceof Error ? err.message : String(err),
    })
  }

  try {
    await dispararHandoffSeNecessario({
      aiResponse,
      conversaId,
      cliente,
      numeroContato,
    })
  } catch (err) {
    logger.error('webhook: erro no handoff por email', {
      erro: err instanceof Error ? err.message : String(err),
    })
  }
}

async function dispararHandoffSeNecessario(args: {
  aiResponse: AiResponse
  conversaId: string
  cliente: { id: string; nomeNegocio: string; emailPrestador: string }
  numeroContato: string
}): Promise<void> {
  const { aiResponse, conversaId, cliente, numeroContato } = args
  if (aiResponse.suggestBook !== true) return

  const conversa = await prisma.whatsappConversation.findUnique({
    where: { id: conversaId },
    select: { handoffEm: true },
  })

  const agora = new Date()
  const ultimo = conversa?.handoffEm ?? null
  if (ultimo && agora.getTime() - ultimo.getTime() < HANDOFF_COOLDOWN_MS) {
    logger.info('handoff pulado (dentro de 24h)', {
      conversaId,
      ultimoHandoffEm: ultimo.toISOString(),
    })
    return
  }

  const result = await resend.enviarHandoff({
    emailPrestador: cliente.emailPrestador,
    nomeNegocio: cliente.nomeNegocio,
    leadNome: aiResponse.leadNome ?? null,
    leadContato: numeroContato,
    leadIntencao: aiResponse.leadIntencao ?? null,
    leadResumo: aiResponse.leadResumo ?? null,
    quando: agora,
  })

  if (result.success) {
    await prisma.whatsappConversation.update({
      where: { id: conversaId },
      data: { handoffEm: agora },
    })
    logger.info('handoff enviado', {
      conversaId,
      emailId: result.id,
      emailPrestador: cliente.emailPrestador,
      leadNome: aiResponse.leadNome ?? null,
      leadContato: numeroContato,
      leadIntencao: aiResponse.leadIntencao ?? null,
      leadResumo: aiResponse.leadResumo ?? null,
    })
  } else {
    logger.warn('handoff falhou (success=false)', {
      conversaId,
      emailId: result.id,
    })
  }
}
