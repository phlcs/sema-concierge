import { callAnthropic } from './anthropic'
import { callGemini } from './gemini'
import { callOpenAI } from './openai'
import { getAiConfig } from './config'
import { FALLBACK_RESPONSE, type AiResponse } from './schema'
import type { Ferramentas } from './ferramentas'
import { VERSAO_PROMPT } from './build-prestador-prompt'
import {
  registrarResposta,
  USO_VAZIO,
  type ContextoRegistro,
  type ResultadoProvedor,
} from './registro'
import { logger } from '@/lib/logger'
import { registrarEvento, resumoErro } from '@/lib/eventos'

type HistoryMessage = { role: 'user' | 'assistant'; content: string }

interface ChatCompleteOptions {
  // Parte fixa (prompt base + cérebro): prefixo cacheável, igual em toda mensagem
  systemPrompt: string
  // Parte que muda a cada mensagem (dados do momento, continuação/anúncio); vai depois da fixa
  systemPromptMomento?: string
  history: HistoryMessage[]
  userMessage: string
  // Quem pediu a chamada: vai para o registro técnico e para os eventos
  contexto: ContextoRegistro
  // Ferramentas que a IA pode chamar (T9). Só a OpenAI usa; os outros provedores ignoram.
  ferramentas?: Ferramentas
}

export async function chatComplete({
  systemPrompt,
  systemPromptMomento = '',
  history,
  userMessage,
  contexto,
  ferramentas,
}: ChatCompleteOptions): Promise<AiResponse> {
  let provider: string = process.env.AI_PROVIDER ?? 'anthropic'
  let model = process.env.AI_MODEL ?? ''
  const inicio = Date.now()

  try {
    const config = getAiConfig()
    provider = config.provider
    model = config.model
    const { apiKey } = config

    let resultado: ResultadoProvedor
    switch (config.provider) {
      case 'gemini':
        resultado = await callGemini(apiKey, model, systemPrompt, systemPromptMomento, history, userMessage)
        break
      case 'openai':
        resultado = await callOpenAI(apiKey, model, systemPrompt, systemPromptMomento, history, userMessage, ferramentas)
        break
      default:
        resultado = await callAnthropic(apiKey, model, systemPrompt, systemPromptMomento, history, userMessage)
    }

    const { saida, uso } = resultado
    await Promise.all([
      registrarResposta({
        contexto,
        funcao: 'resposta',
        provedor: provider,
        modelo: model,
        versaoPrompt: VERSAO_PROMPT,
        uso,
        tempoMs: Date.now() - inicio,
        ferramentas: resultado.ferramentas ?? [],
        sucesso: saida.problema !== 'leitura',
      }),
      saida.problema === 'leitura'
        ? registrarEvento('ia_falha_leitura', {
            clienteId: contexto.clienteId,
            detalhe: detalheDoContexto(contexto, provider, model),
          })
        : saida.problema === 'vazamento'
          ? registrarEvento('ia_vazamento', {
              clienteId: contexto.clienteId,
              detalhe: detalheDoContexto(contexto, provider, model),
            })
          : Promise.resolve(),
    ])
    return saida.resposta
  } catch (err) {
    logger.error('chatComplete: provider error', { provider, error: err instanceof Error ? err.message : String(err) })
    await Promise.all([
      registrarResposta({
        contexto,
        funcao: 'resposta',
        provedor: provider,
        modelo: model || 'desconhecido',
        versaoPrompt: VERSAO_PROMPT,
        uso: USO_VAZIO,
        tempoMs: Date.now() - inicio,
        ferramentas: [],
        sucesso: false,
      }),
      registrarEvento('ia_erro_provedor', {
        clienteId: contexto.clienteId,
        detalhe: { ...detalheDoContexto(contexto, provider, model), ...resumoErro(err) },
      }),
    ])
    return FALLBACK_RESPONSE
  }
}

function detalheDoContexto(contexto: ContextoRegistro, provedor: string, modelo: string) {
  return {
    origem: contexto.origem,
    provedor,
    modelo: modelo || null,
    conversaId: contexto.conversaId ?? null,
    demoId: contexto.demoId ?? null,
  }
}

export type { AiResponse }
