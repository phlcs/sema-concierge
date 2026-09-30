import OpenAI from 'openai'
import { validateOutput } from './validate-output'
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
        { role: 'system', content: systemPrompt },
        ...history.map((h) => ({ role: h.role, content: h.content })),
        { role: 'user' as const, content: userMessage },
      ],
    },
    { timeout: 20000 }
  )

  const raw = response.choices[0]?.message?.content ?? ''

  return validateOutput(raw)
}
