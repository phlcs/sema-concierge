import OpenAI, { toFile } from 'openai'
import { logger } from '@/lib/logger'

const MODELO_PADRAO = 'gpt-4o-mini-transcribe'
const TIMEOUT_MS = 30_000

export function modeloDeAudio(): string {
  return process.env.AI_AUDIO_MODEL?.trim() || MODELO_PADRAO
}

// A transcrição é sempre da OpenAI, qualquer que seja o AI_PROVIDER do atendimento.
// Mesmas variáveis que getAiConfig() aceita para o provider openai.
function chaveOpenAI(): string {
  const chave =
    process.env.OPENAI_API_KEY ||
    (process.env.AI_PROVIDER?.trim().toLowerCase() === 'openai' ? process.env.AI_API_KEY : '')
  if (!chave) throw new Error('chave da OpenAI não configurada (OPENAI_API_KEY) para transcrever áudio')
  return chave
}

const EXTENSOES: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'm4a',
  'audio/amr': 'amr',
  'audio/webm': 'webm',
  'audio/wav': 'wav',
}

let _client: { chave: string; client: OpenAI } | undefined

// Devolve o texto do áudio. Lança se a chave faltar, a chamada falhar ou o texto vier vazio.
// O texto transcrito nunca vai para o log.
export async function transcreverAudio(buffer: Buffer, mime: string): Promise<string> {
  const chave = chaveOpenAI()
  if (_client?.chave !== chave) _client = { chave, client: new OpenAI({ apiKey: chave }) }

  const model = modeloDeAudio()
  const tipo = mime.split(';')[0].trim().toLowerCase()
  const file = await toFile(buffer, `audio.${EXTENSOES[tipo] ?? 'ogg'}`, { type: tipo })

  const res = await _client.client.audio.transcriptions.create(
    { file, model, language: 'pt' },
    { timeout: TIMEOUT_MS },
  )

  logger.info('openai: áudio transcrito', { model, bytes: buffer.length, caracteres: res.text.length })

  const texto = res.text.trim()
  if (!texto) throw new Error('transcrição vazia')
  return texto
}
