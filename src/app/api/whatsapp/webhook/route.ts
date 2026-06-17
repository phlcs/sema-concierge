import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { enviarTexto } from '@/lib/whatsapp/send'
import { chatComplete } from '@/lib/ai'
import { validateInput } from '@/lib/ai/validate-input'
import { buildPrestadorPrompt } from '@/lib/ai/build-prestador-prompt'
import { BLOCKED_RESPONSE, FALLBACK_RESPONSE, type AiResponse } from '@/lib/ai/schema'

// TEMP DIAGNOSTIC: detectar caminho da resposta (normal / fallback / output-leak)
function classifyResponsePath(resp: AiResponse): 'fallback_from_chat_error' | 'output_term_leak' | 'normal' {
  if (resp === FALLBACK_RESPONSE) return 'fallback_from_chat_error'
  const first = resp.paragraphs?.[0] ?? ''
  if (first.startsWith('Sou o assistente do Rafael, especializado em IR')) return 'output_term_leak'
  return 'normal'
}

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

        // TEMP DIAGNOSTIC: tamanho e prefixo do texto recebido do Meta
        logger.info('webhook[DIAG]: texto recebido', {
          phoneNumberId,
          textoLen: texto.length,
          textoPrefix: texto.slice(0, 40),
        })

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

  if (cliente.status !== 'ativo') {
    logger.warn('cliente inativo', { phoneNumberId })
    return
  }

  const inputCheck = validateInput(texto)
  let mensagem: string
  if (!inputCheck.ok) {
    logger.warn('webhook: entrada bloqueada por validateInput', {
      phoneNumberId,
      reason: inputCheck.reason,
      // TEMP DIAGNOSTIC: qual regex casou (presente só quando reason=injection_attempt)
      matchedIndex: inputCheck.matchedIndex,
      matchedPattern: inputCheck.matchedPattern,
      textoLen: texto.length,
      textoPrefix: texto.slice(0, 40),
    })
    mensagem = renderResposta(BLOCKED_RESPONSE)
  } else {
    // TEMP DIAGNOSTIC: passou pelo validateInput
    logger.info('webhook[DIAG]: validateInput passou — chamando chatComplete', {
      phoneNumberId,
      textoLen: texto.length,
    })
    const systemPrompt = buildPrestadorPrompt(cliente.cerebro)
    const aiResponse = await chatComplete({
      systemPrompt,
      history: [],
      userMessage: texto,
    })
    // TEMP DIAGNOSTIC: por qual caminho a resposta saiu
    const path = classifyResponsePath(aiResponse)
    logger.info('webhook[DIAG]: caminho da resposta', {
      phoneNumberId,
      path,
      paragraphsPrefix: (aiResponse.paragraphs?.[0] ?? '').slice(0, 80),
    })
    mensagem = renderResposta(aiResponse)
  }

  await enviarTexto({
    token: process.env.WHATSAPP_TOKEN ?? '',
    phoneNumberId: cliente.phoneNumberId,
    para: deNumero,
    mensagem,
  })
}
