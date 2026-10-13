import { prisma } from '@/lib/prisma'
import { nomeRemetente } from '@/lib/atendimento/pacote'

const FORMATO_TOKEN = /^[0-9a-f]{64}$/

// Link de teste do cliente (T7): /demo/{testeToken}. Nulo ou vencido = bloqueado.
function linkLiberado(liberadoAte: Date | null, agora: Date): liberadoAte is Date {
  return liberadoAte !== null && liberadoAte.getTime() > agora.getTime()
}

// "id" é o id do Cliente dono do link
export type DemoPublica = {
  id: string
  nomeNegocio: string
  numeroExibicao: string
  emailExibicao: string
  // Remetente do e-mail de encaminhamento, mostrado no card (T10)
  remetenteExibicao: string
}

export type AcessoDemo =
  | { estado: 'inexistente' }
  | { estado: 'encerrada'; demo: DemoPublica }
  | { estado: 'ativa'; demo: DemoPublica }

// Só devolve campos que podem ir pro navegador. O cérebro nunca é lido aqui.
export async function carregarDemo(token: string, agora: Date = new Date()): Promise<AcessoDemo> {
  if (!FORMATO_TOKEN.test(token)) return { estado: 'inexistente' }

  const cliente = await prisma.cliente.findUnique({
    where: { testeToken: token },
    select: {
      id: true,
      nomeNegocio: true,
      numeroExibicao: true,
      emailPrestador: true,
      nomeRemetente: true,
      testeLiberadoAte: true,
    },
  })
  if (!cliente) return { estado: 'inexistente' }

  const publica: DemoPublica = {
    id: cliente.id,
    nomeNegocio: cliente.nomeNegocio,
    numeroExibicao: cliente.numeroExibicao ?? '',
    emailExibicao: cliente.emailPrestador,
    remetenteExibicao: nomeRemetente(cliente),
  }

  if (!linkLiberado(cliente.testeLiberadoAte, agora)) {
    return { estado: 'encerrada', demo: publica }
  }
  return { estado: 'ativa', demo: publica }
}

export type DemoConversa = DemoPublica & {
  cerebro: unknown
  // Lista de campos do pedido (T8), usada pela ferramenta de encaminhamento (T9)
  camposPedido: unknown
  limiteMensagens: number
  expiraEm: Date
  // Início da liberação atual: o limite de mensagens conta a partir daqui
  liberadoEm: Date | null
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

  const cliente = await prisma.cliente.findUnique({
    where: { testeToken: token },
    select: {
      id: true,
      nomeNegocio: true,
      numeroExibicao: true,
      emailPrestador: true,
      nomeRemetente: true,
      cerebro: true,
      camposPedido: true,
      testeLimiteMensagens: true,
      testeLiberadoAte: true,
      testeLiberadoEm: true,
    },
  })
  if (!cliente) return { estado: 'inexistente' }

  if (!linkLiberado(cliente.testeLiberadoAte, agora)) {
    return { estado: 'encerrada' }
  }
  return {
    estado: 'ativa',
    demo: {
      id: cliente.id,
      nomeNegocio: cliente.nomeNegocio,
      numeroExibicao: cliente.numeroExibicao ?? '',
      emailExibicao: cliente.emailPrestador,
      remetenteExibicao: nomeRemetente(cliente),
      cerebro: cliente.cerebro,
      camposPedido: cliente.camposPedido,
      limiteMensagens: cliente.testeLimiteMensagens,
      expiraEm: cliente.testeLiberadoAte,
      liberadoEm: cliente.testeLiberadoEm,
    },
  }
}
