import OpenAI from 'openai'
import { validarSaida } from './validate-output'
import { logger } from '@/lib/logger'
import type { FerramentaChamada, ResultadoProvedor } from './registro'
import { MAX_RODADAS_FERRAMENTA, type Ferramentas } from './ferramentas'
import type {
  FunctionTool,
  Response,
  ResponseFunctionToolCall,
  ResponseInputItem,
} from 'openai/resources/responses/responses'

type HistoryMessage = { role: 'user' | 'assistant'; content: string }

const MAX_RESULTADO_REGISTRO = 1000

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

function statusDoErro(err: unknown): number | null {
  const status = (err as { status?: unknown })?.status
  return typeof status === 'number' ? status : null
}

// Responses API (/v1/responses): é a única forma em que os modelos de raciocínio
// aceitam ferramenta junto com reasoning (o chat.completions recusa com 400).
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

  // Parte fixa primeiro: o cache automático da OpenAI reaproveita o prefixo idêntico
  // O prompt vai como mensagem de sistema (developer) dentro do input, não em
  // `instructions`: com text.format json_object a API exige a palavra "json" nas
  // mensagens do input, e `instructions` não conta.
  const instructions = [systemPrompt, systemPromptMomento].filter(Boolean).join('\n\n')
  const input: ResponseInputItem[] = [
    { role: 'developer' as const, content: instructions },
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: 'user' as const, content: userMessage },
  ]
  const tools: FunctionTool[] = (ferramentas?.definicoes ?? []).map((f) => ({
    type: 'function' as const,
    name: f.nome,
    description: f.descricao,
    parameters: f.parametros,
    strict: false,
  }))

  const uso = { tokensEntrada: null as number | null, tokensSaida: null as number | null, tokensCache: null as number | null }
  const chamadas: FerramentaChamada[] = []
  let ferramentasRecusadas = false
  let motivoRecusa: string | undefined
  let raw = ''

  const chamar = (comFerramentas: boolean): Promise<Response> =>
    client.responses.create(
      {
        model,
        input,
        ...(isReasoningModel(model)
          ? { reasoning: { effort: 'low' as const }, max_output_tokens: 4000 }
          : { temperature: 0.3, max_output_tokens: 1200 }),
        text: { format: { type: 'json_object' } },
        ...(comFerramentas ? { tools } : {}),
      },
      { timeout: 20000 }
    )

  // Ciclo de ferramentas (T9): a IA pode chamar uma ferramenta, recebe o resultado
  // e só então escreve a resposta. Na última rodada as ferramentas saem, para
  // obrigar a resposta final.
  for (let rodada = 0; rodada <= MAX_RODADAS_FERRAMENTA; rodada++) {
    let comFerramentas = tools.length > 0 && !ferramentasRecusadas && rodada < MAX_RODADAS_FERRAMENTA
    let response: Response
    try {
      response = await chamar(comFerramentas)
    } catch (err) {
      // Rede de segurança: se a OpenAI recusar a chamada com ferramenta, responde sem
      // ela. O lead nunca fica sem resposta; o encaminhamento deste turno se perde.
      if (!comFerramentas || statusDoErro(err) !== 400) throw err
      motivoRecusa = err instanceof Error ? err.message.slice(0, 300) : String(err)
      logger.warn('openai: chamada com ferramenta recusada, repetindo sem ferramenta', {
        model,
        erro: motivoRecusa,
      })
      ferramentasRecusadas = true
      comFerramentas = false
      for (const t of tools) chamadas.push({ nome: t.name, resultado: 'erro_provedor' })
      response = await chamar(false)
    }

    logger.info('openai: uso de tokens', {
      model,
      rodada,
      promptTokens: response.usage?.input_tokens ?? null,
      cachedTokens: response.usage?.input_tokens_details?.cached_tokens ?? null,
      completionTokens: response.usage?.output_tokens ?? null,
    })
    uso.tokensEntrada = somar(uso.tokensEntrada, response.usage?.input_tokens)
    uso.tokensSaida = somar(uso.tokensSaida, response.usage?.output_tokens)
    uso.tokensCache = somar(uso.tokensCache, response.usage?.input_tokens_details?.cached_tokens)

    const pedidas = response.output.filter(
      (item): item is ResponseFunctionToolCall => item.type === 'function_call'
    )
    if (!comFerramentas || !ferramentas || pedidas.length === 0) {
      raw = response.output_text ?? ''
      break
    }

    // Devolve à IA tudo o que ela produziu (raciocínio e chamadas) e o resultado de cada chamada
    input.push(...(response.output as ResponseInputItem[]))
    for (const pedida of pedidas) {
      let args: unknown = null
      try {
        args = JSON.parse(pedida.arguments || '{}')
      } catch {
        args = null
      }
      const resultado = await ferramentas.executar(pedida.name, args)
      // O registro guarda o começo: o resultado da busca nos documentos (T14) é longo
      chamadas.push({ nome: pedida.name, resultado: resultado.slice(0, MAX_RESULTADO_REGISTRO) })
      input.push({ type: 'function_call_output', call_id: pedida.call_id, output: resultado })
    }
  }

  return {
    saida: validarSaida(raw),
    uso: { ...uso, tokensCacheEscrita: null },
    ferramentas: chamadas,
    ...(motivoRecusa ? { ferramentaRecusada: motivoRecusa } : {}),
  }
}
