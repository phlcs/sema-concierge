import { AiResponseSchema, type AiResponse, FALLBACK_RESPONSE } from './schema'
import { logger } from '@/lib/logger'

const FORBIDDEN_TERMS = [
  'system prompt',
  'instruções internas',
  'regras internas',
  'Claude',
  'Gemini',
  'Anthropic',
  'Google',
]

function containsForbiddenTerm(text: string): boolean {
  const lower = text.toLowerCase()
  return FORBIDDEN_TERMS.some((term) => lower.includes(term.toLowerCase()))
}

function textLeak(response: AiResponse): boolean {
  const allText = [
    ...(response.paragraphs ?? []),
    ...(response.checklist ?? []),
    ...(response.steps?.map((s) => `${s.title} ${s.description}`) ?? []),
    response.bookReason ?? '',
  ].join(' ')

  return containsForbiddenTerm(allText)
}

function tryExtractJson(raw: string): unknown {
  // Try direct parse
  try {
    return JSON.parse(raw)
  } catch {
    // Try markdown code fence first (```json ... ``` or ``` ... ```)
    const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
    if (fenceMatch?.[1]) {
      try {
        return JSON.parse(fenceMatch[1].trim())
      } catch {
        // fall through
      }
    }
    // Try extracting outermost JSON object (handles leading/trailing text)
    const objStart = raw.indexOf('{')
    const objEnd = raw.lastIndexOf('}')
    if (objStart !== -1 && objEnd > objStart) {
      try {
        return JSON.parse(raw.slice(objStart, objEnd + 1))
      } catch {
        // fall through
      }
    }
    return null
  }
}

export function validateOutput(raw: string): AiResponse {
  const parsed = tryExtractJson(raw)

  if (!parsed) {
    logger.warn('validateOutput: failed to parse JSON from LLM response')
    return FALLBACK_RESPONSE
  }

  const result = AiResponseSchema.safeParse(parsed)

  if (!result.success) {
    logger.warn('validateOutput: Zod validation failed', { issues: result.error.issues.map(i => i.message) })
    return FALLBACK_RESPONSE
  }

  const response = result.data

  // Enforce bookReason when suggestBook is true
  if (response.suggestBook && !response.bookReason) {
    response.bookReason = 'Este caso requer análise personalizada com o Rafael.'
  }

  // Detect system prompt leakage
  if (textLeak(response)) {
    logger.warn('validateOutput: detected forbidden term in LLM output — replacing paragraphs')
    return {
      ...response,
      paragraphs: [
        'Sou o assistente do Rafael, especializado em IR e contabilidade pra pessoa física. Como posso te ajudar?',
      ],
    }
  }

  return response
}
