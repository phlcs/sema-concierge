import { callAnthropic } from './anthropic'
import { callGemini } from './gemini'
import { FALLBACK_RESPONSE, type AiResponse } from './schema'
import { logger } from '@/lib/logger'

type HistoryMessage = { role: 'user' | 'assistant'; content: string }

interface ChatCompleteOptions {
  systemPrompt: string
  history: HistoryMessage[]
  userMessage: string
}

export async function chatComplete({
  systemPrompt,
  history,
  userMessage,
}: ChatCompleteOptions): Promise<AiResponse> {
  const provider = process.env.AI_PROVIDER ?? 'anthropic'

  try {
    if (provider === 'gemini') {
      return await callGemini(systemPrompt, history, userMessage)
    }
    return await callAnthropic(systemPrompt, history, userMessage)
  } catch (err) {
    logger.error('chatComplete: provider error', { provider, error: err instanceof Error ? err.message : String(err) })
    return FALLBACK_RESPONSE
  }
}

export type { AiResponse }
