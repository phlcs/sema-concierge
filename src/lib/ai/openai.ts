import OpenAI from 'openai'
import { validarSaida } from './validate-output'
import { logger } from '@/lib/logger'
import type { FerramentaChamada, ResultadoProvedor } from './registro'
import { MAX_RODADAS_FERRAMENTA, type Ferramentas } from './ferramentas'
import type {
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions'

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

function somar(a: number | null, b: number | null | undefined): number | null {
  if (b == null) return a
  return (a ?? 0) + b
}

export async function callOpenAI(
  apiKey: string,
  model: string,
  systemPrompt: string,
  systemPromptMomento: string,
  history: HistoryMessage[],
  userMessage: string,
  ferramentas?: Ferramentas
): Promise<ResultadoProvedor> {
  const client = getClient(apiKey)

  const messages: ChatCompletionMessageParam[] = [
    // Parte fixa primeiro: o cache automático da OpenAI reaproveita o prefixo idêntico
    { role: 'system', content: [systemPrompt, systemPromptMomento].filter(Boolean).join('\n\n') },
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: 'user' as const, content: userMessage },
  ]
  const tools: ChatCompletionTool[] = (ferramentas?.definicoes ?? []).map((f) => ({
    type: 'function' as const,
    function: { name: f.nome, description: f.descricao, parameters: f.parametros },
  }))

  const uso = { tokensEntrada: null as number | null, tokensSaida: null as number | null, tokensCache: null as number | null }
  const chamadas: FerramentaChamada[] = []
  let raw = ''

  // Ciclo de ferramentas (T9): a IA pode chamar uma ferramenta, recebe o resultado
  // e só então escreve a resposta. Na última rodada as ferramentas saem, para
  // obrigar a resposta final.
  for (let rodada = 0; rodada <= MAX_RODADAS_FERRAMENTA; rodada++) {
    const comFerramentas = tools.length > 0 && rodada < MAX_RODADAS_FERRAMENTA
    const response = await client.chat.completions.create(
      {
        model,
        ...(isReasoningModel(model)
          ? { reasoning_effort: 'low' as const, max_completion_tokens: 4000 }
          : { temperature: 0.3, max_completion_tokens: 1200 }),
        response_format: { type: 'json_object' },
        ...(comFerramentas ? { tools } : {}),
        messages,
      },
      { timeout: 20000 }
    )

    logger.info('openai: uso de tokens', {
      model,
      rodada,
      promptTokens: response.usage?.prompt_tokens ?? null,
      cachedTokens: response.usage?.prompt_tokens_details?.cached_tokens ?? null,
      completionTokens: response.usage?.completion_tokens ?? null,
    })
    uso.tokensEntrada = somar(uso.tokensEntrada, response.usage?.prompt_tokens)
    uso.tokensSaida = somar(uso.tokensSaida, response.usage?.completion_tokens)
    uso.tokensCache = somar(uso.tokensCache, response.usage?.prompt_tokens_details?.cached_tokens)

    const mensagem = response.choices[0]?.message
    const pedidas = (mensagem?.tool_calls ?? []).filter(
      (c): c is ChatCompletionMessageFunctionToolCall => c.type === 'function'
    )
    if (!comFerramentas || !ferramentas || pedidas.length === 0) {
      raw = mensagem?.content ?? ''
      break
    }

    messages.push({ role: 'assistant', content: mensagem?.content ?? null, tool_calls: pedidas })
    for (const pedida of pedidas) {
      let args: unknown = null
      try {
        args = JSON.parse(pedida.function.arguments || '{}')
      } catch {
        args = null
      }
      const resultado = await ferramentas.executar(pedida.function.name, args)
      chamadas.push({ nome: pedida.function.name, resultado })
      messages.push({ role: 'tool', tool_call_id: pedida.id, content: resultado })
    }
  }

  return {
    saida: validarSaida(raw),
    uso: { ...uso, tokensCacheEscrita: null },
    ferramentas: chamadas,
  }
}
