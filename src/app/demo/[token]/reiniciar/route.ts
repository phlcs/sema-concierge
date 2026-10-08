import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { carregarDemoParaConversa } from '@/lib/demo/acesso'
import { COOKIE_SESSAO, novaSessao, opcoesCookieSessao } from '@/lib/demo/sessao'

// Começa uma sessão nova. As mensagens antigas continuam no banco, só saem da tela.
export async function POST(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params

  const acesso = await carregarDemoParaConversa(token)
  if (acesso.estado === 'inexistente') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (acesso.estado === 'encerrada') {
    return NextResponse.json({ error: 'encerrada' }, { status: 410 })
  }

  const sessaoId = novaSessao()
  logger.info('demo: reiniciar', { demoId: acesso.demo.id, sessaoId })

  const res = NextResponse.json({ ok: true })
  res.cookies.set(COOKIE_SESSAO, sessaoId, opcoesCookieSessao(token, acesso.demo.expiraEm))
  return res
}
