import { GoogleGenAI } from '@google/genai'
import { validarSaida } from './validate-output'
import type { ResultadoProvedor } from './registro'

type HistoryMessage = { role: 'user' | 'assistant'; content: string }

let _client: GoogleGenAI | undefined

function getClient(apiKey: string): GoogleGenAI {
  if (!_client) {
    _client = new GoogleGenAI({ apiKey })
  }
  return _client
}

export async function callGemini(
  apiKey: string,
  model: string,
  systemPrompt: string,
  systemPromptMomento: string,
  history: HistoryMessage[],
  userMessage: string
): Promise<ResultadoProvedor> {
  const client = getClient(apiKey)

  const contents = [
    ...history.map((h) => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }],
    })),
    { role: 'user', parts: [{ text: userMessage }] },
  ]

  const generatePromise = client.models.generateContent({
    model,
    contents,
    config: {
      systemInstruction: [systemPrompt, systemPromptMomento].filter(Boolean).join('\n\n'),
      maxOutputTokens: 1200,
      temperature: 0.3,
      responseMimeType: 'application/json',
    },
  })

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Gemini request timed out after 20s')), 20000)
  )

  const response = await Promise.race([generatePromise, timeoutPromise])
  const raw = response.text ?? ''

  // O raciocínio interno do modelo ("thoughts") é cobrado como saída
  const u = response.usageMetadata
  const saida = (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0)
  return {
    saida: validarSaida(raw),
    uso: {
      tokensEntrada: u?.promptTokenCount ?? null,
      tokensSaida: u ? saida : null,
      tokensCache: u?.cachedContentTokenCount ?? null,
      tokensCacheEscrita: null,
    },
  }
}
