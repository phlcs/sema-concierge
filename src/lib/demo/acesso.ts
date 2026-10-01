import { prisma } from '@/lib/prisma'

const FORMATO_TOKEN = /^[0-9a-f]{64}$/

export type DemoPublica = {
  id: string
  nomeNegocio: string
  numeroExibicao: string
}

export type AcessoDemo =
  | { estado: 'inexistente' }
  | { estado: 'encerrada'; demo: DemoPublica }
  | { estado: 'ativa'; demo: DemoPublica }

// Só devolve campos que podem ir pro navegador. O cérebro nunca é lido aqui.
export async function carregarDemo(token: string, agora: Date = new Date()): Promise<AcessoDemo> {
  if (!FORMATO_TOKEN.test(token)) return { estado: 'inexistente' }

  const demo = await prisma.demo.findUnique({
    where: { token },
    select: { id: true, nomeNegocio: true, numeroExibicao: true, status: true, expiraEm: true },
  })
  if (!demo) return { estado: 'inexistente' }

  const publica: DemoPublica = {
    id: demo.id,
    nomeNegocio: demo.nomeNegocio,
    numeroExibicao: demo.numeroExibicao,
  }

  if (demo.status !== 'ativo' || demo.expiraEm.getTime() <= agora.getTime()) {
    return { estado: 'encerrada', demo: publica }
  }
  return { estado: 'ativa', demo: publica }
}
