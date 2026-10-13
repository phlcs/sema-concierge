import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { enviarTexto, marcarComoLidaEDigitando } from '@/lib/whatsapp/send'
import {
  FRASE_AUDIO_LONGO,
  FRASE_MIDIA,
  MAINTENANCE_RESPONSE,
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
import { registrarEvento, resumoErro } from '@/lib/eventos'
import type { ContextoRegistro } from '@/lib/ai/registro'
import { precisaRevisar } from '@/lib/qa/keywords'
import { portaWhatsapp, type EncaminhamentoRegistrado } from '@/lib/atendimento/encaminhamento'
import { montarPacote } from '@/lib/atendimento/pacote'
import { entregarEncaminhamento, type ClienteDestino } from '@/lib/atendimento/destino'

// Evento de assinatura recusada: no máximo 1 por minuto por processo, para que uma
// enxurrada de chamadas falsas ao webhook não encha a tabela (o log registra todas)
const INTERVALO_EVENTO_ASSINATURA_MS = 60_000
let ultimoEventoAssinaturaEm = 0

function contextoWhatsapp(clienteId: string, conversaId?: string): ContextoRegistro {
  return { origem: 'whatsapp', clienteId, conversaId: conversaId ?? null }
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
      if (Date.now() - ultimoEventoAssinaturaEm >= INTERVALO_EVENTO_ASSINATURA_MS) {
        ultimoEventoAssinaturaEm = Date.now()
        await registrarEvento('webhook_assinatura_recusada', {
          detalhe: { temAssinatura: assinatura != null },
        })
      }
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
    void registrarEvento('webhook_erro_geral', { detalhe: resumoErro(err) })
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
      // Sem o wamid: ele embute o telefone do contato
      await registrarEvento('mensagem_duplicada', { detalhe: { phoneNumberId } })
      return
    }
  } catch (err) {
    avisarModoDegradado('recebimento', err)
    degradado = true
  }

  const cliente = await prisma.cliente.findUnique({ where: { phoneNumberId } })
  if (!cliente) {
    logger.warn(`cliente não encontrado para phone_number_id: ${phoneNumberId}`)
    await registrarEvento('cliente_nao_encontrado', {
      detalhe: { phoneNumberId, motivo: 'nao_encontrado' },
    })
    return
  }
  if (cliente.status !== 'ativo' && cliente.status !== 'manutencao') {
    logger.warn('cliente inativo', { phoneNumberId })
    await registrarEvento('cliente_nao_encontrado', {
      clienteId: cliente.id,
      detalhe: { phoneNumberId, motivo: 'inativo', status: cliente.status },
    })
    return
  }

  if (origemAnuncio) {
    logger.info('webhook: mensagem com origem anúncio (referral)', { phoneNumberId })
    await registrarEvento('mensagem_de_anuncio', {
      clienteId: cliente.id,
      detalhe: { phoneNumberId },
    })
  }
  if (tipo !== 'text') {
    await registrarEvento('midia_recebida', {
      clienteId: cliente.id,
      detalhe: { phoneNumberId, tipo },
    })
  }

  void marcarComoLidaEDigitando({
    token: process.env.WHATSAPP_TOKEN ?? '',
    phoneNumberId,
    wamid,
  })

  // A transcrição começa já e corre durante a espera do turno. Só para cliente ativo:
  // em manutenção não há IA, então não se gasta transcrição.
  if (item.tipo === 'audio' && item.mediaId && cliente.status === 'ativo') {
    iniciarTranscricao(wamid, item.mediaId, contextoWhatsapp(cliente.id))
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
    await registrarEvento('cliente_nao_encontrado', {
      detalhe: { phoneNumberId, motivo: 'nao_encontrado' },
    })
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
      phoneNumberId,
      para: deNumero,
      mensagem,
      clienteId: cliente.id,
    })

    logger.info('cliente em manutencao, auto-reply enviado', { phoneNumberId })
    await registrarEvento('manutencao_resposta_automatica', {
      clienteId: cliente.id,
      detalhe: { phoneNumberId, conversaId },
    })
    return
  }

  if (cliente.status !== 'ativo') {
    logger.warn('cliente inativo', { phoneNumberId })
    await registrarEvento('cliente_nao_encontrado', {
      clienteId: cliente.id,
      detalhe: { phoneNumberId, motivo: 'inativo', status: cliente.status },
    })
    return
  }

  // Texto digitado e áudio transcrito entram igual, na ordem de chegada. As
  // transcrições já correm desde a chegada do áudio; aqui só se espera o resultado.
  const entradas = await Promise.all(
    itens.map(async (i): Promise<{ msg?: MensagemEntrada; frase?: string }> => {
      if (i.tipo === 'texto') return i.texto ? { msg: i.texto } : {}
      if (i.tipo === 'midia') return { frase: FRASE_MIDIA }
      const r = await aguardarTranscricao(i.wamid, i.mediaId ?? '', contextoWhatsapp(cliente.id))
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
      phoneNumberId,
      para: deNumero,
      mensagem: frases || FRASE_MIDIA,
      clienteId: cliente.id,
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
    contexto: contextoWhatsapp(cliente.id, conversaId),
    encaminhamento: {
      camposPedido: cliente.camposPedido,
      porta: portaWhatsapp(cliente.id, conversaId),
    },
  })
  const { bloqueio, encaminhamentos } = resultado
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
    phoneNumberId,
    para: deNumero,
    mensagem,
    clienteId: cliente.id,
  })

  try {
    if (precisaRevisar(texto) || precisaRevisar(mensagem)) {
      await prisma.whatsappConversation.update({
        where: { id: conversaId },
        data: { revisar: true },
      })
      logger.info('conversa marcada pra revisão', { conversaId })
      await registrarEvento('conversa_marcada_revisao', {
        clienteId: cliente.id,
        detalhe: { conversaId },
      })
    }
  } catch (err) {
    logger.error('webhook: erro ao marcar conversa para revisão', {
      erro: err instanceof Error ? err.message : String(err),
    })
    await registrarEvento('revisao_erro', {
      clienteId: cliente.id,
      detalhe: { conversaId, ...resumoErro(err) },
    })
  }

  // Cada encaminhamento registrado pelas ferramentas neste turno (novo, atualização,
  // cancelamento) vai para o destino do cadastro (T10). A resposta à pessoa já saiu:
  // se a entrega falhar, fica o evento de erro.
  for (const encaminhamento of encaminhamentos) {
    try {
      await enviarEncaminhamento({ encaminhamento, conversaId, cliente, numeroContato })
    } catch (err) {
      logger.error('webhook: erro na entrega do encaminhamento', {
        tipo: encaminhamento.tipo,
        erro: err instanceof Error ? err.message : String(err),
      })
      await registrarEvento('encaminhamento_falha_email', {
        clienteId: cliente.id,
        detalhe: { conversaId, tipo: encaminhamento.tipo, ...resumoErro(err) },
      })
    }
  }
}

async function enviarEncaminhamento(args: {
  encaminhamento: EncaminhamentoRegistrado
  conversaId: string
  cliente: ClienteDestino
  numeroContato: string
}): Promise<void> {
  const { encaminhamento, conversaId, cliente, numeroContato } = args
  const agora = new Date()
  const pacote = montarPacote({
    nomeNegocio: cliente.nomeNegocio,
    contato: numeroContato,
    encaminhamento,
    quando: agora,
  })

  const r = await entregarEncaminhamento({ cliente, pacote, conversaId })
  if (r.ok) {
    // handoffEm marca a conversa na lista do admin: só o encaminhamento novo
    if (pacote.tipo === 'novo') {
      await prisma.whatsappConversation.update({
        where: { id: conversaId },
        data: { handoffEm: agora },
      })
    }
    logger.info('encaminhamento entregue', {
      conversaId,
      tipo: pacote.tipo,
      destino: r.destino,
      id: r.id,
      emailPrestador: cliente.emailPrestador,
      nomeContato: pacote.nomeContato,
      contato: numeroContato,
      campos: pacote.campos,
      resumo: pacote.resumo,
      mudou: pacote.mudou,
    })
    // O e-mail do prestador e os dados do contato ficam só no log; o evento leva ids
    await registrarEvento(r.modo === 'real' ? 'encaminhamento_enviado' : 'encaminhamento_mock', {
      clienteId: cliente.id,
      detalhe: { conversaId, tipo: pacote.tipo, destino: r.destino, emailId: r.id },
    })
  } else if (r.motivo === 'success_false') {
    logger.warn('encaminhamento falhou (success=false)', {
      conversaId,
      tipo: pacote.tipo,
      emailId: r.id,
    })
    await registrarEvento('encaminhamento_falha_email', {
      clienteId: cliente.id,
      detalhe: { conversaId, tipo: pacote.tipo, emailId: r.id ?? null, motivo: 'success_false' },
    })
  }
}
