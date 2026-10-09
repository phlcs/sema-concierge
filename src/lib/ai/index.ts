import { callAnthropic } from './anthropic'
import { callGemini } from './gemini'
import { callOpenAI } from './openai'
import { getAiConfig } from './config'
import { FALLBACK_RESPONSE, type AiResponse } from './schema'
import { logger } from '@/lib/logger'

type HistoryMessage = { role: 'user' | 'assistant'; content: string }

interface ChatCompleteOptions {
  // Parte fixa (prompt base + cérebro): prefixo cacheável, igual em toda mensagem
  systemPrompt: string
  // Parte que muda a cada mensagem (dados do momento, continuação/anúncio); vai depois da fixa
  systemPromptMomento?: string
  history: HistoryMessage[]
  userMessage: string
}

export async function chatComplete({
  systemPrompt,
  systemPromptMomento = '',
  history,
  userMessage,
}: ChatCompleteOptions): Promise<AiResponse> {
  let provider: string = process.env.AI_PROVIDER ?? 'anthropic'

  try {
    const config = getAiConfig()
    provider = config.provider
    const { apiKey, model } = config

    switch (config.provider) {
      case 'gemini':
        return await callGemini(apiKey, model, systemPrompt, systemPromptMomento, history, userMessage)
      case 'openai':
        return await callOpenAI(apiKey, model, systemPrompt, systemPromptMomento, history, userMessage)
      default:
        return await callAnthropic(apiKey, model, systemPrompt, systemPromptMomento, history, userMessage)
    }
  } catch (err) {
    logger.error('chatComplete: provider error', { provider, error: err instanceof Error ? err.message : String(err) })
    return FALLBACK_RESPONSE
  }
}

export type { AiResponse }
