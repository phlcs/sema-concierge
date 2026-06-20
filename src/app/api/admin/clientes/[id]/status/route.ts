import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isAdminAuthed } from '@/lib/admin/guard'

const TOGGLABLE = ['ativo', 'manutencao'] as const
type ToggleStatus = (typeof TOGGLABLE)[number]

function isToggleStatus(v: unknown): v is ToggleStatus {
  return typeof v === 'string' && (TOGGLABLE as readonly string[]).includes(v)
}

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

  const status = (body as { status?: unknown })?.status
  if (!isToggleStatus(status)) {
    return NextResponse.json(
      { error: 'invalid_status', message: 'status deve ser "ativo" ou "manutencao"' },
      { status: 400 },
    )
  }

  const atual = await prisma.cliente.findUnique({
    where: { id },
    select: { status: true },
  })
  if (!atual) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  if (!isToggleStatus(atual.status)) {
    return NextResponse.json(
      {
        error: 'locked_status',
        message: `Cliente com status "${atual.status}" não pode ser alternado por aqui.`,
      },
      { status: 409 },
    )
  }

  const updated = await prisma.cliente.update({
    where: { id },
    data: { status },
    select: { id: true, status: true },
  })

  return NextResponse.json({ ok: true, id: updated.id, status: updated.status })
}
