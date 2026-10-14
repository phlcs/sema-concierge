import OpenAI from 'openai'

// Transcrição de áudio (T4) e documentos (T14) são sempre da OpenAI, qualquer que seja
// o AI_PROVIDER do atendimento. Mesmas variáveis que getAiConfig() aceita para o provider openai.
export function chaveOpenAI(): string {
  const chave =
    process.env.OPENAI_API_KEY ||
    (process.env.AI_PROVIDER?.trim().toLowerCase() === 'openai' ? process.env.AI_API_KEY : '')
  if (!chave) throw new Error('chave da OpenAI não configurada (OPENAI_API_KEY)')
  return chave
}

let _client: { chave: string; client: OpenAI } | undefined

// Cliente reaproveitado enquanto a chave não muda
export function clienteOpenAI(): OpenAI {
  const chave = chaveOpenAI()
  if (_client?.chave !== chave) _client = { chave, client: new OpenAI({ apiKey: chave }) }
  return _client.client
}
