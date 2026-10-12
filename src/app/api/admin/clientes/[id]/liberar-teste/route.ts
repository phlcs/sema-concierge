import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isAdminAuthed } from '@/lib/admin/guard'
import { registrarEvento } from '@/lib/eventos'

// Link de teste (T7): liberar abre por DIAS_LIBERACAO a partir de agora e zera
// a contagem do limite de mensagens; bloquear fecha na hora.
const DIAS_LIBERACAO = 7

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { id } = await ctx.params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  const acao = (body as { acao?: unknown })?.acao
  if (acao !== 'liberar' && acao !== 'bloquear') {
    return NextResponse.json(
      { error: 'invalid_acao', message: 'acao deve ser "liberar" ou "bloquear"' },
      { status: 400 },
    )
  }

  const atual = await prisma.cliente.findUnique({ where: { id }, select: { id: true } })
  if (!atual) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const agora = new Date()
  const data =
    acao === 'liberar'
      ? {
          testeLiberadoAte: new Date(agora.getTime() + DIAS_LIBERACAO * 24 * 60 * 60 * 1000),
          testeLiberadoEm: agora,
        }
      : { testeLiberadoAte: null }

  const updated = await prisma.cliente.update({
    where: { id },
    data,
    select: { id: true, testeLiberadoAte: true },
  })

  await registrarEvento(acao === 'liberar' ? 'teste_liberado' : 'teste_bloqueado', {
    clienteId: id,
    detalhe: acao === 'liberar' ? { dias: DIAS_LIBERACAO } : undefined,
  })

  return NextResponse.json({
    ok: true,
    id: updated.id,
    testeLiberadoAte: updated.testeLiberadoAte?.toISOString() ?? null,
  })
}
