import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { bateriaAutorizada, naoEncontrado } from '@/lib/bateria/acesso'

// Bateria (T6): o cérebro do cliente, para montar as buscas das personas
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!bateriaAutorizada(req)) return naoEncontrado()
  const { id } = await ctx.params

  const cliente = await prisma.cliente.findUnique({
    where: { id },
    select: { id: true, nomeNegocio: true, cerebro: true },
  })
  if (!cliente) return naoEncontrado()
  return NextResponse.json(cliente)
}
