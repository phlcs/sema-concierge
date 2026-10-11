import Anthropic from '@anthropic-ai/sdk'
import { validarSaida } from './validate-output'
import type { ResultadoProvedor } from './registro'

type HistoryMessage = { role: 'user' | 'assistant'; content: string }

let _client: Anthropic | undefined

function getClient(apiKey: string): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey })
  }
  return _client
}

export async function callAnthropic(
  apiKey: string,
  model: string,
  systemPrompt: string,
  systemPromptMomento: string,
  history: HistoryMessage[],
  userMessage: string
): Promise<ResultadoProvedor> {
  const client = getClient(apiKey)

  const response = await client.messages.create(
    {
      model,
      max_tokens: 1200,
      temperature: 0.3,
      // Parte fixa com cache_control (prefixo estável entre mensagens); a do momento fica fora do cache
      system: [
        {
          type: 'text' as const,
          text: systemPrompt,
          cache_control: { type: 'ephemeral' as const },
        },
        ...(systemPromptMomento ? [{ type: 'text' as const, text: systemPromptMomento }] : []),
      ],
      messages: [
        ...history.map((h) => ({
          role: h.role,
          content: h.content,
        })),
        { role: 'user' as const, content: userMessage },
      ],
    },
    { timeout: 20000 }
  )

  const textBlock = response.content.find((b) => b.type === 'text')
  const raw = textBlock?.type === 'text' ? textBlock.text : ''

  // input_tokens não inclui o cache; a entrada total soma as três partes
  const u = response.usage
  const lidos = u.cache_read_input_tokens ?? 0
  const escritos = u.cache_creation_input_tokens ?? 0
  return {
    saida: validarSaida(raw),
    uso: {
      tokensEntrada: u.input_tokens + lidos + escritos,
      tokensSaida: u.output_tokens,
      tokensCache: lidos,
      tokensCacheEscrita: escritos,
    },
  }
}
