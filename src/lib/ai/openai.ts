import OpenAI from 'openai'
import { validateOutput } from './validate-output'
import { logger } from '@/lib/logger'
import type { AiResponse } from './schema'

type HistoryMessage = { role: 'user' | 'assistant'; content: string }

let _client: OpenAI | undefined

function getClient(apiKey: string): OpenAI {
  if (!_client) {
    _client = new OpenAI({ apiKey })
  }
  return _client
}

// Modelos de raciocínio (gpt-5+, o-series) não aceitam temperature e usam reasoning_effort
function isReasoningModel(model: string): boolean {
  return /^(o\d|gpt-([5-9]|\d{2}))/.test(model) && !model.includes('chat-latest')
}

export async function callOpenAI(
  apiKey: string,
  model: string,
  systemPrompt: string,
  systemPromptMomento: string,
  history: HistoryMessage[],
  userMessage: string
): Promise<AiResponse> {
  const client = getClient(apiKey)

  const response = await client.chat.completions.create(
    {
      model,
      ...(isReasoningModel(model)
        ? { reasoning_effort: 'low' as const, max_completion_tokens: 4000 }
        : { temperature: 0.3, max_completion_tokens: 1200 }),
      response_format: { type: 'json_object' },
      messages: [
        // Parte fixa primeiro: o cache automático da OpenAI reaproveita o prefixo idêntico
        { role: 'system', content: [systemPrompt, systemPromptMomento].filter(Boolean).join('\n\n') },
        ...history.map((h) => ({ role: h.role, content: h.content })),
        { role: 'user' as const, content: userMessage },
      ],
    },
    { timeout: 20000 }
  )

  logger.info('openai: uso de tokens', {
    model,
    promptTokens: response.usage?.prompt_tokens ?? null,
    cachedTokens: response.usage?.prompt_tokens_details?.cached_tokens ?? null,
    completionTokens: response.usage?.completion_tokens ?? null,
  })

  const raw = response.choices[0]?.message?.content ?? ''

  return validateOutput(raw)
}
