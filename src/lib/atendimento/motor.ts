import { chatComplete } from '@/lib/ai'
import { validateInput } from '@/lib/ai/validate-input'
import { buildPrestadorPrompt } from '@/lib/ai/build-prestador-prompt'
import { BLOCKED_RESPONSE, FALLBACK_RESPONSE, type AiResponse } from '@/lib/ai/schema'
import { logger } from '@/lib/logger'

export type HistoryMessage = { role: 'user' | 'assistant'; content: string }

const INSTRUCAO_CONTINUACAO =
  '\n\n# CONTINUAÇÃO DE CONVERSA\nEsta conversa JÁ ESTÁ em andamento com este cliente. NÃO se reapresente, NÃO repita a saudação inicial e NÃO pergunte o nome de novo se já souber. Responda direto, dando continuidade ao que já foi conversado.\n'

const INSTRUCAO_ORIGEM_ANUNCIO =
  '\n\n# ORIGEM: ANÚNCIO\nEsta conversa começou por um anúncio. O cliente já recebeu uma mensagem de abertura automática que se apresentou e o convidou a responder. NÃO se apresente de novo, não dê boas-vindas nem repita quem você é. Responda direto ao que ele disse e siga a conversa de forma natural, qualificando como sempre.\n'

export function renderResposta(resposta: AiResponse): string {
  const paragrafos = (resposta.paragraphs ?? []).map((p) => p.trim()).filter(Boolean)
  if (paragrafos.length === 0) return FALLBACK_RESPONSE.paragraphs.join('\n\n')
  return paragrafos.join('\n\n')
}

export type ResultadoMotor = {
  mensagem: string
  aiResponse: AiResponse
  // reason do validateInput quando a entrada foi bloqueada; null quando passou
  bloqueio: string | null
}

// Motor de atendimento compartilhado pelas "portas" (webhook do WhatsApp, demo):
// filtro de entrada, prompt com o cérebro, chamada da IA e filtro de saída.
// Persistência, envio, QA e handoff ficam em cada porta.
export async function responderMensagem(args: {
  cerebro: unknown
  texto: string
  ehPrimeiraMensagem: boolean
  origemAnuncio: boolean
  // só é chamado quando a entrada passa no filtro
  carregarHistorico: () => Promise<HistoryMessage[]>
}): Promise<ResultadoMotor> {
  const { cerebro, texto, ehPrimeiraMensagem, origemAnuncio, carregarHistorico } = args

  const inputCheck = validateInput(texto)
  if (!inputCheck.ok) {
    return {
      mensagem: renderResposta(BLOCKED_RESPONSE),
      aiResponse: BLOCKED_RESPONSE,
      bloqueio: inputCheck.reason,
    }
  }

  const history = await carregarHistorico()
  let systemPrompt = buildPrestadorPrompt(cerebro)
  if (!ehPrimeiraMensagem) systemPrompt += INSTRUCAO_CONTINUACAO
  if (origemAnuncio && ehPrimeiraMensagem) systemPrompt += INSTRUCAO_ORIGEM_ANUNCIO

  let aiResponse: AiResponse
  try {
    aiResponse = await chatComplete({ systemPrompt, history, userMessage: texto })
  } catch (err) {
    logger.error('webhook: chatComplete falhou', {
      erro: err instanceof Error ? err.message : String(err),
    })
    aiResponse = FALLBACK_RESPONSE
  }

  return { mensagem: renderResposta(aiResponse), aiResponse, bloqueio: null }
}
