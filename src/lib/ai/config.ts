export type AiProvider = 'anthropic' | 'gemini' | 'openai'

const PROVIDERS: AiProvider[] = ['anthropic', 'gemini', 'openai']

const DEFAULT_MODELS: Record<AiProvider, string> = {
  anthropic: 'claude-haiku-4-5',
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-5.4-mini',
}

// Variáveis antigas por provider — aceitas como fallback pra não quebrar deploys existentes
const LEGACY_KEY_VARS: Record<AiProvider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GOOGLE_API_KEY',
  openai: 'OPENAI_API_KEY',
}

const LEGACY_MODEL_VARS: Record<AiProvider, string> = {
  anthropic: 'ANTHROPIC_MODEL',
  gemini: 'GEMINI_MODEL',
  openai: 'OPENAI_MODEL',
}

export interface AiConfig {
  provider: AiProvider
  apiKey: string
  model: string
}

export function getAiConfig(): AiConfig {
  const raw = (process.env.AI_PROVIDER ?? 'anthropic').trim().toLowerCase()
  if (!PROVIDERS.includes(raw as AiProvider)) {
    throw new Error(`AI_PROVIDER inválido: "${raw}". Use: ${PROVIDERS.join(' | ')}`)
  }
  const provider = raw as AiProvider

  const apiKey = process.env.AI_API_KEY || process.env[LEGACY_KEY_VARS[provider]]
  if (!apiKey) throw new Error(`AI_API_KEY não está configurado (provider: ${provider})`)

  const model = process.env.AI_MODEL || process.env[LEGACY_MODEL_VARS[provider]] || DEFAULT_MODELS[provider]

  return { provider, apiKey, model }
}
