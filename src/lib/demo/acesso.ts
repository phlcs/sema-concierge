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

export type DemoConversa = DemoPublica & {
  cerebro: unknown
  limiteMensagens: number
  expiraEm: Date
}

export type AcessoConversa =
  | { estado: 'inexistente' }
  | { estado: 'encerrada' }
  | { estado: 'ativa'; demo: DemoConversa }

// Uso exclusivo no servidor: traz o cérebro para o motor. Nada daqui vai pro navegador.
export async function carregarDemoParaConversa(
  token: string,
  agora: Date = new Date(),
): Promise<AcessoConversa> {
  if (!FORMATO_TOKEN.test(token)) return { estado: 'inexistente' }

  const demo = await prisma.demo.findUnique({
    where: { token },
    select: {
      id: true,
      nomeNegocio: true,
      numeroExibicao: true,
      cerebro: true,
      limiteMensagens: true,
      status: true,
      expiraEm: true,
    },
  })
  if (!demo) return { estado: 'inexistente' }

  if (demo.status !== 'ativo' || demo.expiraEm.getTime() <= agora.getTime()) {
    return { estado: 'encerrada' }
  }
  return {
    estado: 'ativa',
    demo: {
      id: demo.id,
      nomeNegocio: demo.nomeNegocio,
      numeroExibicao: demo.numeroExibicao,
      cerebro: demo.cerebro,
      limiteMensagens: demo.limiteMensagens,
      expiraEm: demo.expiraEm,
    },
  }
}
