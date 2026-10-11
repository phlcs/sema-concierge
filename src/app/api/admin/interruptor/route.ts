import { NextResponse } from 'next/server'
import { isAdminAuthed } from '@/lib/admin/guard'
import { senhaDoAdminConfere } from '@/lib/admin/senha'
import { desligarInterruptorGeral, ligarInterruptorGeral } from '@/lib/admin/interruptor'
import { logger } from '@/lib/logger'

// Interruptor geral de manutenção (T5).
//  - { acao: 'ligar', senha }: exige a senha do admin de novo; coloca em manutenção
//    todos os clientes ativos.
//  - { acao: 'desligar' }: volta ao normal, sem pedir a senha (devolver o atendimento
//    nunca deve travar); reativa só os clientes que o geral colocou em manutenção.
export async function POST(req: Request) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: { acao?: unknown; senha?: unknown }
  try {
    body = (await req.json()) as { acao?: unknown; senha?: unknown }
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  if (body.acao === 'ligar') {
    const senha = typeof body.senha === 'string' ? body.senha : ''
    if (!senhaDoAdminConfere(senha)) {
      logger.warn('interruptor geral: senha incorreta, nada foi alterado')
      return NextResponse.json(
        { error: 'senha_incorreta', message: 'Senha incorreta. Nada foi alterado.' },
        { status: 403 },
      )
    }
    const { afetados } = await ligarInterruptorGeral()
    logger.warn('interruptor geral LIGADO: clientes ativos colocados em manutenção', { afetados })
    return NextResponse.json({ ok: true, ligado: true, afetados })
  }

  if (body.acao === 'desligar') {
    const { restaurados } = await desligarInterruptorGeral()
    logger.warn('interruptor geral DESLIGADO: voltou ao normal', { restaurados })
    return NextResponse.json({ ok: true, ligado: false, restaurados })
  }

  return NextResponse.json(
    { error: 'invalid_acao', message: 'acao deve ser "ligar" ou "desligar"' },
    { status: 400 },
  )
}
