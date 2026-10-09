import { createHmac, timingSafeEqual } from 'node:crypto'

// Confere o cabeçalho X-Hub-Signature-256 da Meta: "sha256=" + HMAC-SHA256
// (hex) do corpo cru, usando a chave secreta do app.
export function assinaturaValida(
  corpoCru: string,
  cabecalho: string | null,
  segredo: string,
): boolean {
  if (!cabecalho || !segredo) return false
  const esperado = 'sha256=' + createHmac('sha256', segredo).update(corpoCru, 'utf8').digest('hex')
  const a = Buffer.from(cabecalho, 'utf8')
  const b = Buffer.from(esperado, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}
