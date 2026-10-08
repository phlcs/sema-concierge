import { AiResponseSchema, type AiResponse, FALLBACK_RESPONSE, LEAK_RESPONSE } from './schema'
import { logger } from '@/lib/logger'

// Menções ao sistema/provedor. Com fronteira de palavra pra não dar falso positivo
// em nome de pessoa (ex.: "Claudete" não casa com "claude").
const FORBIDDEN_PATTERNS: RegExp[] = [
  /system\s+prompt/i,
  /prompt\s+do\s+sistema/i,
  /instru[çc][õo]es\s+internas/i,
  /regras\s+internas/i,
  /\bclaude\b/i,
  /\bgemini\b/i,
  /\banthropic\b/i,
  /\bopenai\b/i,
  /\bchatgpt\b/i,
  /\bgpt-?\d/i,
]

// Trechos fixos do template de build-prestador-prompt.ts. Se o modelo despejar o prompt,
// ao menos um deles aparece. Ao mudar títulos/campos lá, atualizar aqui.
const LEAK_MARKERS: RegExp[] = [
  // Títulos em MAIÚSCULAS (sem flag i): "como encaminhar" em frase normal não pode casar
  /SEGURAN[ÇC]A\s+[—–-]\s+REGRA/,
  /REGRA\s+ACIMA\s+DE\s+TODAS/,
  /A\s+CERCA\s+[—–-]/,
  /FORMATO\s+DE\s+RESPOSTA/,
  /JSON\s+OBRIGAT[ÓO]RIO/,
  /CONTEXTO\s+DO\s+NEG[ÓO]CIO/,
  /COMO\s+ENCAMINHAR/,
  /\b(NOME_DO_NEGOCIO|NOME_ASSISTENTE|NOME_PRESTADOR|PRAZO_RETORNO|RESUMO_NEGOCIO|PRECOS_GERAIS|COMO_FUNCIONA|O_QUE_SEMPRE_ESCALA|PERGUNTAS_FREQUENTES|OUTRAS_INFORMACOES|CAMPO_LIVRE)\b/,
  /\b(suggestBook|bookReason|leadNome|leadIntencao|leadResumo)\b/,
  // Marcadores de bloco do prompt e das instruções de continuação/anúncio do motor
  /<\/?(seguranca|identidade|idioma|como_voce_fala|o_que_voce_faz|cerca|agenda_e_pagamento|quando_nao_sabe|mensagem_curta|dados_do_cliente|audio_e_midia|como_encaminhar|formato_de_resposta|cerebro|dados_do_momento|continuacao|origem_anuncio)>/,
]

function allText(response: AiResponse): string {
  return [
    ...(response.paragraphs ?? []),
    ...(response.checklist ?? []),
    ...(response.steps?.map((s) => `${s.title} ${s.description}`) ?? []),
    response.bookReason ?? '',
    response.leadNome ?? '',
    response.leadIntencao ?? '',
    response.leadResumo ?? '',
  ].join('\n')
}

function textLeak(response: AiResponse): boolean {
  const text = allText(response)
  return FORBIDDEN_PATTERNS.some((p) => p.test(text)) || LEAK_MARKERS.some((p) => p.test(text))
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
    response.bookReason = 'Este caso requer atendimento personalizado.'
  }

  // Detect system prompt leakage — resposta genérica, sem handoff nem dados de lead
  if (textLeak(response)) {
    logger.warn('validateOutput: detected leak in LLM output — replaced by generic response')
    return LEAK_RESPONSE
  }

  return response
}
