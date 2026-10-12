import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { estimarCustoUsd, type UsoTokens } from './precos'
import type { SaidaValidada } from './validate-output'

// De onde veio a chamada: WhatsApp de cliente real, link de teste (demo) ou bateria de personas
export type Origem = 'whatsapp' | 'teste' | 'bateria'
export type Funcao = 'resposta' | 'busca_documentos' | 'resumo' | 'transcricao'

// Quem pediu a chamada. Só identificadores.
export type ContextoRegistro = {
  origem: Origem
  clienteId?: string | null
  demoId?: string | null
  conversaId?: string | null
}

export type FerramentaChamada = { nome: string; resultado: string }

export type UsoIa = UsoTokens

// O que cada provedor devolve: a resposta já validada e o consumo medido na chamada
export type ResultadoProvedor = {
  saida: SaidaValidada
  uso: UsoIa
  // Ferramentas chamadas no ciclo (só OpenAI, T9)
  ferramentas?: FerramentaChamada[]
  // Motivo, quando o provedor recusou a chamada com ferramenta e a resposta saiu sem ela
  ferramentaRecusada?: string
}

export const USO_VAZIO: UsoIa = {
  tokensEntrada: null,
  tokensSaida: null,
  tokensCache: null,
  tokensCacheEscrita: null,
}

// Grava o registro técnico de uma chamada de IA. Nunca lança nem atrasa o
// atendimento: se o banco falhar, só deixa uma linha no log.
export async function registrarResposta(args: {
  contexto: ContextoRegistro
  funcao: Funcao
  provedor: string
  modelo: string
  versaoPrompt?: string | null
  uso: UsoIa
  tempoMs: number
  ferramentas?: FerramentaChamada[]
  // Quando a função tem custo próprio (ex.: transcrição, cobrada por minuto)
  custoEstimadoUsd?: number | null
  sucesso: boolean
}): Promise<void> {
  const { contexto, uso } = args
  try {
    const custo =
      args.custoEstimadoUsd !== undefined
        ? args.custoEstimadoUsd
        : estimarCustoUsd(args.provedor, args.modelo, uso)
    await prisma.registroResposta.create({
      data: {
        origem: contexto.origem,
        funcao: args.funcao,
        clienteId: contexto.clienteId ?? null,
        demoId: contexto.demoId ?? null,
        conversaId: contexto.conversaId ?? null,
        provedor: args.provedor,
        modelo: args.modelo,
        versaoPrompt: args.versaoPrompt ?? null,
        tokensEntrada: uso.tokensEntrada,
        tokensSaida: uso.tokensSaida,
        tokensCache: uso.tokensCache,
        tokensCacheEscrita: uso.tokensCacheEscrita,
        tempoMs: Math.max(0, Math.round(args.tempoMs)),
        ferramentas: args.ferramentas ?? [],
        custoEstimadoUsd: custo,
        sucesso: args.sucesso,
      },
    })
  } catch (err) {
    logger.error('registro: falha ao gravar o registro técnico da resposta', {
      funcao: args.funcao,
      erro: err instanceof Error ? err.message : String(err),
    })
  }
}
