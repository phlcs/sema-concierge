import { NextResponse } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { isAdminAuthed } from '@/lib/admin/guard'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { id } = await ctx.params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: 'invalid_body', message: 'Corpo da requisição inválido.' },
      { status: 400 },
    )
  }

  const texto = (body as { cerebro?: unknown })?.cerebro
  if (typeof texto !== 'string') {
    return NextResponse.json(
      { error: 'invalid_payload', message: 'Campo "cerebro" deve ser uma string com JSON.' },
      { status: 400 },
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(texto)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'JSON inválido.'
    return NextResponse.json({ error: 'invalid_json', message }, { status: 400 })
  }

  const atual = await prisma.cliente.findUnique({
    where: { id },
    select: { id: true },
  })
  if (!atual) {
    return NextResponse.json({ error: 'not_found', message: 'Cliente não encontrado.' }, { status: 404 })
  }

  await prisma.cliente.update({
    where: { id },
    data: { cerebro: parsed as Prisma.InputJsonValue },
  })

  return NextResponse.json({ ok: true })
}
