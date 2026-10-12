import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { bateriaAutorizada, naoEncontrado } from '@/lib/bateria/acesso'

// Bateria (T6): lista os cadastros para o script achar o cliente pelo nome
export async function GET(req: Request) {
  if (!bateriaAutorizada(req)) return naoEncontrado()

  const clientes = await prisma.cliente.findMany({
    select: { id: true, nomeNegocio: true, status: true },
    orderBy: { nomeNegocio: 'asc' },
  })
  return NextResponse.json({ clientes })
}
