import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { enviarTexto, marcarComoLidaEDigitando } from '@/lib/whatsapp/send'
import {
  FRASE_AUDIO_LONGO,
  FRASE_MIDIA,
  MAINTENANCE_RESPONSE,
  type AiResponse,
} from '@/lib/ai/schema'
import { renderResposta, responderMensagem, type MensagemEntrada } from '@/lib/atendimento/motor'
import { normalizarNumero } from '@/lib/whatsapp/phone'
import { assinaturaValida } from '@/lib/whatsapp/assinatura'
import { aguardarTranscricao, iniciarTranscricao } from '@/lib/whatsapp/audio'
import {
  adicionarAoTurno,
  avisarModoDegradado,
  registrarSeNova,
  type ItemTurno,
} from '@/lib/whatsapp/turno'
import {
  acharOuCriarConversa,
  carregarHistorico,
  salvarMensagem,
} from '@/lib/whatsapp/conversa'
import { resend } from '@/lib/integrations/resend'
import { precisaRevisar } from '@/lib/qa/keywords'

const HANDOFF_COOLDOWN_MS = 24 * 60 * 60 * 1000

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
  id?: string
  from?: string
  type?: string
  text?: { body?: string }
  audio?: { id?: string }
  referral?: unknown
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
  const raw = await req.text()

  // Sem APP_SECRET o webhook segue como antes (sem verificar) e avisa no log a
  // cada evento. Com ela, evento sem assinatura válida é recusado.
  const segredo = process.env.APP_SECRET
  if (!segredo) {
    logger.warn('webhook: APP_SECRET não configurada, assinatura não verificada')
  } else {
    const assinatura = req.headers.get('x-hub-signature-256')
    if (!assinaturaValida(raw, assinatura, segredo)) {
      logger.warn('webhook: assinatura inválida ou ausente, evento recusado', {
        temAssinatura: assinatura != null,
      })
      return new NextResponse('Unauthorized', { status: 401 })
    }
  }

  let body: MetaBody
  try {
    body = JSON.parse(raw) as MetaBody
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
        await receberMensagem(phoneNumberId, message)
      }
    }
  }
}

const TIPOS_MIDIA = new Set(['audio', 'image', 'document', 'video'])

// Recebimento: dedupe, lida + "digitando…" e entrada no buffer do turno.
// A resposta sai só quando o cliente fica 10s sem mandar nada (ver turno.ts).
async function receberMensagem(phoneNumberId: string, message: MetaMessage): Promise<void> {
  const tipo = message.type
  const deNumero = message.from
  const wamid = message.id
  if (!tipo || !deNumero || !wamid) return

  // Figurinha, reação, localização etc.: ignoradas
  const ehTexto = tipo === 'text'
  if (!ehTexto && !TIPOS_MIDIA.has(tipo)) return
  const texto = message.text?.body
  if (ehTexto && !texto) return

  const origemAnuncio = message.referral != null
  if (origemAnuncio) {
    logger.info('webhook: mensagem com origem anúncio (referral)', { phoneNumberId })
  }

  // Áudio com media ID vira transcrição; sem ele, ou outra mídia, segue a frase fixa
  const mediaIdAudio = tipo === 'audio' ? message.audio?.id : undefined
  const item: ItemTurno = {
    wamid,
    tipo: ehTexto ? 'texto' : mediaIdAudio ? 'audio' : 'midia',
    texto: ehTexto ? texto : undefined,
    mediaId: mediaIdAudio,
    origemAnuncio,
    recebidaEm: Date.now(),
  }

  // Redis fora do ar: sem dedupe; a mensagem segue e é respondida na hora
  let degradado = false
  try {
    if (!(await registrarSeNova(wamid))) {
      logger.info('webhook: mensagem duplicada descartada', { phoneNumberId, wamid })
      return
    }
  } catch (err) {
    avisarModoDegradado('recebimento', err)
    degradado = true
  }

  const cliente = await prisma.cliente.findUnique({ where: { phoneNumberId } })
  if (!cliente) {
    logger.warn(`cliente não encontrado para phone_number_id: ${phoneNumberId}`)
    return
  }
  if (cliente.status !== 'ativo' && cliente.status !== 'manutencao') {
    logger.warn('cliente inativo', { phoneNumberId })
    return
  }

  void marcarComoLidaEDigitando({
    token: process.env.WHATSAPP_TOKEN ?? '',
    phoneNumberId,
    wamid,
  })

  // A transcrição começa já e corre durante a espera do turno. Só para cliente ativo:
  // em manutenção não há IA, então não se gasta transcrição.
  if (item.tipo === 'audio' && item.mediaId && cliente.status === 'ativo') {
    iniciarTranscricao(wamid, item.mediaId)
  }

  if (!degradado) {
    try {
      await adicionarAoTurno({ phoneNumberId, deNumero, item, tratar: tratarTurno })
      return
    } catch (err) {
      avisarModoDegradado('recebimento', err)
    }
  }

  // Modo degradado: uma mensagem = uma resposta, sem espera nem junção
  await tratarTurno({ phoneNumberId, deNumero, itens: [item] })
}

function marcadorBloqueio(motivo: string): string {
  return motivo === 'too_long' ? '[mensagem bloqueada: muito longa]' : '[mensagem bloqueada]'
}

async function tratarTurno(args: {
  phoneNumberId: string
  deNumero: string
  itens: ItemTurno[]
}): Promise<void> {
  const { phoneNumberId, deNumero, itens } = args

  const origemAnuncio = itens.some((i) => i.origemAnuncio)

  const cliente = await prisma.cliente.findUnique({ where: { phoneNumberId } })

  if (!cliente) {
    logger.warn(`cliente não encontrado para phone_number_id: ${phoneNumberId}`)
    return
  }

  if (cliente.status === 'manutencao') {
    const numeroContato = normalizarNumero(deNumero)
    const { conversaId } = await acharOuCriarConversa(cliente.id, numeroContato)
    const mensagem = renderResposta(MAINTENANCE_RESPONSE)

    const digitado = itens.flatMap((i) => (i.tipo === 'texto' && i.texto ? [i.texto] : []))
    await salvarMensagem(conversaId, 'USER', digitado.join('\n') || '[mídia]')
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

  // Texto digitado e áudio transcrito entram igual, na ordem de chegada. As
  // transcrições já correm desde a chegada do áudio; aqui só se espera o resultado.
  const entradas = await Promise.all(
    itens.map(async (i): Promise<{ msg?: MensagemEntrada; frase?: string }> => {
      if (i.tipo === 'texto') return i.texto ? { msg: i.texto } : {}
      if (i.tipo === 'midia') return { frase: FRASE_MIDIA }
      const r = await aguardarTranscricao(i.wamid, i.mediaId ?? '')
      if (r.ok) return { msg: { texto: r.texto, deAudio: true } }
      return { frase: r.motivo === 'longo' ? FRASE_AUDIO_LONGO : FRASE_MIDIA }
    }),
  )
  const mensagens = entradas.flatMap((e) => (e.msg ? [e.msg] : []))
  const frases = [...new Set(entradas.flatMap((e) => (e.frase ? [e.frase] : [])))].join('\n\n')
  const textos = mensagens.map((m) => (typeof m === 'string' ? m : m.texto))
  const texto = textos.join('\n')

  // Só mídia (ou áudio sem texto aproveitável): frase fixa, sem IA. Não cria
  // conversa nem grava, para o primeiro texto que vier depois ainda ser tratado
  // como primeira mensagem.
  if (mensagens.length === 0) {
    await enviarTexto({
      token: process.env.WHATSAPP_TOKEN ?? '',
      phoneNumberId: cliente.phoneNumberId,
      para: deNumero,
      mensagem: frases || FRASE_MIDIA,
    })
    return
  }

  // A conversa só nasce aqui, depois da espera: evita colisão da chave única em rajada
  const numeroContato = normalizarNumero(deNumero)
  const { conversaId, ehPrimeiraMensagem } = await acharOuCriarConversa(
    cliente.id,
    numeroContato,
  )

  const resultado = await responderMensagem({
    cerebro: cliente.cerebro,
    mensagens,
    ehPrimeiraMensagem,
    origemAnuncio,
    carregarHistorico: () => carregarHistorico(conversaId),
  })
  const { aiResponse, bloqueio } = resultado
  if (bloqueio) {
    // Só um trecho vai pro log (pra auditar o que é bloqueado); o texto não é gravado
    logger.warn('webhook: entrada bloqueada por validateInput', {
      phoneNumberId,
      reason: bloqueio,
      tamanho: texto.length,
      trecho: texto.slice(0, 300),
    })
  }
  const mensagem = frases ? `${resultado.mensagem}\n\n${frases}` : resultado.mensagem

  // Texto bloqueado não vai pro histórico: voltaria ao modelo sem passar pelo filtro
  await salvarMensagem(conversaId, 'USER', bloqueio ? marcadorBloqueio(bloqueio) : texto)
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
