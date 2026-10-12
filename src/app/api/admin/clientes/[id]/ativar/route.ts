import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isAdminAuthed } from '@/lib/admin/guard'

// Prospect vira cliente ativo (T8): só com o ID do número na Meta preenchido.
// A partir daqui o WhatsApp do número passa a ser atendido.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { id } = await ctx.params

  const atual = await prisma.cliente.findUnique({
    where: { id },
    select: { status: true, phoneNumberId: true },
  })
  if (!atual) {
    return NextResponse.json({ error: 'not_found', message: 'Cliente não encontrado.' }, { status: 404 })
  }
  if (atual.status !== 'prospect') {
    return NextResponse.json(
      { error: 'locked_status', message: 'Só um prospect pode ser ativado por aqui.' },
      { status: 409 },
    )
  }
  if (!atual.phoneNumberId) {
    return NextResponse.json(
      { error: 'sem_numero', message: 'Preencha e salve o ID do número na Meta antes de ativar.' },
      { status: 400 },
    )
  }

  await prisma.cliente.update({ where: { id }, data: { status: 'ativo' } })
  return NextResponse.json({ ok: true })
}
