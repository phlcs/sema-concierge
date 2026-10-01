type InputOk = { ok: true }
type InputBlocked = { ok: false; reason: string }

const TRIGGER_PATTERNS: RegExp[] = [
  /ignore\s+as\s+instru[çc][õo]es/i,
  /ignore\s+previous/i,
  /esqueça\s+suas\s+instru[çc][õo]es/i,
  /esquece\s+tudo/i,
  /system\s+prompt/i,
  /prompt\s+do\s+sistema/i,
  /revele?\s+seu\s+prompt/i,
  /mostre?\s+seu\s+prompt/i,
  /\bact\s+as\b/i,
  /\baja\s+como\b/i,
  /\bfinja\s+que\b/i,
  /você\s+agora\s+[eé]/i,
  /pretend\s+you\s+are/i,
  /\bjailbreak\b/i,
  /\bDAN\b/,
  /developer\s+mode/i,
  /modo\s+desenvolvedor/i,
  /ignore\s+all\s+previous/i,
  /\bdisregard\b/i,
  // Pedidos coloquiais pelo prompt/instruções. Sempre ancorados em seu/teu/suas
  // pra não pegar "instruções de pagamento", "regras de cancelamento" etc.
  /\b(seu|teu)\s+prompt\b/i,
  /\b(passa|manda|envia|mostra|cola|repete|revela|diz|fala|traduz\w*|resum\w*|me\s+d[aá])\b[^.?!\n]{0,25}\b(seu|teu|suas|tuas)\s+(prompt|instru[çc][õo]es|diretrizes|regras\s+internas)/i,
  /\b(quais|qual)\b[^.?!\n]{0,20}\b(suas|tuas|seu|teu)\s+(instru[çc][õo]es|diretrizes|prompt|regras\s+internas)/i,
  /o\s+que\s+(te|lhe)\s+(mandaram|instru[ií]ram|programaram)/i,
  /\b(como|quem)\s+(te|voc[êe])\s+(programou|configurou|instruiu)/i,
  /\brep[ei]t[ae]\b[^.?!\n]{0,30}\b(acima|anterior|inicial)/i,
  /\bfoi\s+(programad|configurad|instru[ií]d)[oa]/i,
]

export function validateInput(message: string): InputOk | InputBlocked {
  if (message.length < 1) {
    return { ok: false, reason: 'too_short' }
  }

  if (message.length > 500) {
    return { ok: false, reason: 'too_long' }
  }

  for (const pattern of TRIGGER_PATTERNS) {
    if (pattern.test(message)) {
      return { ok: false, reason: 'injection_attempt' }
    }
  }

  return { ok: true }
}
