import { Prisma } from '@/generated/prisma/client'

// Erro conhecido ao gravar o cadastro: o ID do número da Meta já está em outro cliente.
export function erroDeGravacao(
  e: unknown,
): { status: number; corpo: { error: string; message: string } } | null {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    return {
      status: 409,
      corpo: {
        error: 'duplicado',
        message: 'Esse ID do número na Meta já está cadastrado em outro cliente.',
      },
    }
  }
  return null
}
