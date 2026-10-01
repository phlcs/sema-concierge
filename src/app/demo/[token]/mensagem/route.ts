import { NextResponse, type NextRequest } from 'next/server'
import { logger } from '@/lib/logger'
import { getAiConfig } from '@/lib/ai/config'
import { responderMensagem } from '@/lib/atendimento/motor'
import { carregarDemoParaConversa } from '@/lib/demo/acesso'
import {
  LIMITE_CARACTERES,
  MSG_LONGA,
  MSG_TETO,
  carregarHistoricoDemo,
  contarMensagensSessao,
  contarMensagensUsuario,
  salvarMensagemDemo,
} from '@/lib/demo/conversa'
import { COOKIE_SESSAO, novaSessao, opcoesCookieSessao, sessaoValida } from '@/lib/demo/sessao'

const LIMITE_CORPO_BYTES = 4096

function infoProvider(): { provider: string | null; model: string | null } {
  try {
    const { provider, model } = getAiConfig()
    return { provider, model }
  } catch {
    return { provider: null, model: null }
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params

  const acesso = await carregarDemoParaConversa(token)
  if (acesso.estado === 'inexistente') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (acesso.estado === 'encerrada') {
    return NextResponse.json({ error: 'encerrada' }, { status: 410 })
  }
  const demo = acesso.demo

  const tamanhoDeclarado = Number(req.headers.get('content-length') ?? '0')
  if (tamanhoDeclarado > LIMITE_CORPO_BYTES) {
    return NextResponse.json({ error: 'too_large' }, { status: 413 })
  }
  const bruto = await req.text()
  if (bruto.length > LIMITE_CORPO_BYTES) {
    return NextResponse.json({ error: 'too_large' }, { status: 413 })
  }

  let texto: string
  try {
    const valor = (JSON.parse(bruto) as { texto?: unknown })?.texto
    if (typeof valor !== 'string') throw new Error('texto ausente')
    texto = valor.trim()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }
  if (!texto) {
    return NextResponse.json({ error: 'empty' }, { status: 400 })
  }

  // Respostas fixas: sem IA e sem gravar nada
  if (texto.length > LIMITE_CARACTERES) {
    return NextResponse.json({ texto: MSG_LONGA })
  }
  if ((await contarMensagensUsuario(demo.id)) >= demo.limiteMensagens) {
    logger.info('demo: teto de mensagens atingido', { demoId: demo.id })
    return NextResponse.json({ texto: MSG_TETO })
  }

  const sessaoId = sessaoValida(req.cookies.get(COOKIE_SESSAO)?.value) ?? novaSessao()
  const recebidaEm = new Date()
  const ehPrimeiraMensagem = (await contarMensagensSessao(demo.id, sessaoId)) === 0

  const { mensagem, bloqueio } = await responderMensagem({
    cerebro: demo.cerebro,
    texto,
    ehPrimeiraMensagem,
    origemAnuncio: false,
    carregarHistorico: () => carregarHistoricoDemo(demo.id, sessaoId),
  })

  await salvarMensagemDemo({
    demoId: demo.id,
    sessaoId,
    role: 'USER',
    texto,
    createdAt: recebidaEm,
  })
  await salvarMensagemDemo({
    demoId: demo.id,
    sessaoId,
    role: 'ASSISTANT',
    texto: mensagem,
    createdAt: new Date(Math.max(Date.now(), recebidaEm.getTime() + 1)),
  })

  logger.info('demo: mensagem', {
    demoId: demo.id,
    sessaoId,
    ...infoProvider(),
    bloqueio,
  })

  const res = NextResponse.json({ texto: mensagem })
  res.cookies.set(COOKIE_SESSAO, sessaoId, opcoesCookieSessao(token, demo.expiraEm))
  return res
}
