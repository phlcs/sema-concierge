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
  /MODO\s+DE\s+ATENDIMENTO/,
  /CANAIS\s+DO\s+CLIENTE/,
  /A\s+CERCA\s+\((LIGADA|NEUTRA|INVERTIDA)\)/,
  /DEPOIS\s+DO\s+ENCAMINHAMENTO\s+\(/,
  /\b(NOME_DO_NEGOCIO|NOME_ASSISTENTE|NOME_PRESTADOR|PRAZO_RETORNO|RESUMO_NEGOCIO|PRECOS_GERAIS|COMO_FUNCIONA|O_QUE_SEMPRE_ESCALA|PERGUNTAS_FREQUENTES|OUTRAS_INFORMACOES|CAMPO_LIVRE|AJUSTE_CERCA|AJUSTE_DA_CERCA|LIMITADORES|REGRAS_DE_DECISAO|AVISOS_E_NOVIDADES)\b/,
  /\b(suggestBook|bookReason|leadNome|leadIntencao|leadResumo|registrar_pedido|atualizar_pedido|cancelar_pedido|o_que_mudou|buscar_documentos|enviar_documento)\b/,
  // Títulos e marcador de documentos (T14)
  /DOCUMENTOS\s+DO\s+NEG[ÓO]CIO/,
  /\[documento enviado\]/i,
  // Marcadores de bloco do prompt e das instruções de continuação/anúncio do motor
  /<\/?(seguranca|identidade|idioma|como_voce_fala|o_que_voce_faz|cerca|agenda_e_pagamento|quando_nao_sabe|mensagem_curta|dados_do_cliente|audio_e_midia|como_encaminhar|formato_de_resposta|cerebro|dados_do_momento|estado_encaminhamento|continuacao|origem_anuncio|pedidos_agenda_e_pagamento|desvios|modo|canais_do_cliente|resumo_conversa|documentos)>/,
]

function allText(response: AiResponse): string {
  return [
    ...(response.paragraphs ?? []),
    ...(response.checklist ?? []),
    ...(response.steps?.map((s) => `${s.title} ${s.description}`) ?? []),
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

// 'leitura': a resposta não veio como o JSON esperado; 'vazamento': o filtro de saída a trocou
export type ProblemaSaida = 'leitura' | 'vazamento'

export type SaidaValidada = { resposta: AiResponse; problema: ProblemaSaida | null }

export function validarSaida(raw: string): SaidaValidada {
  const parsed = tryExtractJson(raw)

  if (!parsed) {
    logger.warn('validateOutput: failed to parse JSON from LLM response')
    return { resposta: FALLBACK_RESPONSE, problema: 'leitura' }
  }

  const result = AiResponseSchema.safeParse(parsed)

  if (!result.success) {
    logger.warn('validateOutput: Zod validation failed', { issues: result.error.issues.map(i => i.message) })
    return { resposta: FALLBACK_RESPONSE, problema: 'leitura' }
  }

  const response = result.data

  // Detect system prompt leakage — resposta genérica. Só troca o texto: um
  // encaminhamento já registrado pela ferramenta nunca é desfeito aqui (T9).
  if (textLeak(response)) {
    logger.warn('validateOutput: detected leak in LLM output — replaced by generic response')
    return { resposta: LEAK_RESPONSE, problema: 'vazamento' }
  }

  return { resposta: response, problema: null }
}

export function validateOutput(raw: string): AiResponse {
  return validarSaida(raw).resposta
}
