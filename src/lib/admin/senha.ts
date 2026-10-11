import { timingSafeEqual } from 'node:crypto'

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  // Compare against a buffer of the same length to keep timing constant,
  // then AND with a length-equality check so different lengths still fail.
  const len = Math.max(ab.length, bb.length, 1)
  const ap = Buffer.alloc(len)
  const bp = Buffer.alloc(len)
  ab.copy(ap)
  bb.copy(bp)
  const eq = timingSafeEqual(ap, bp)
  return eq && ab.length === bb.length
}

// Confere a senha digitada com a do admin (ADMIN_PASSWORD). Sem a variável, recusa sempre.
export function senhaDoAdminConfere(digitada: string): boolean {
  const esperada = process.env.ADMIN_PASSWORD
  if (!esperada || esperada.length === 0) return false
  return safeEqual(digitada, esperada)
}
