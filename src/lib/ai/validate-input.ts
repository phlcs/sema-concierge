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
]

export function validateInput(message: string): InputOk | InputBlocked {
  if (message.length < 2) {
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
