export const KEYWORDS: RegExp[] = [
  // insatisfação / reclamação
  /\breclam/i, /\bpessim/i, /\bhorrivel/i, /\babsurd/i, /\bridicul/i,
  /\bvergonha\b/i, /\bdescaso\b/i, /\bpalhacad/i, /\binaceitavel/i,
  /\bdecepc/i, /\binsatisfeit/i, /\bnunca mais\b/i,
  // cancelamento / saída
  /\bcancel/i, /\bdesist/i, /nao quero mais/i,
  // risco jurídico / financeiro
  /\badvogad/i, /\bprocon\b/i, /\bprocess(ar|o)/i, /\bjustica\b/i,
  /\bdenunci/i, /\breembols/i, /\bestorno\b/i, /devolver.{0,12}dinheiro/i,
  /\bgolpe\b/i, /\bfraude\b/i, /\bengan(o|ar|ado|acao)/i,
  // bot errando / quer humano / urgência
  /\berr(o|ad)/i, /\bmentir/i, /\brobo\b/i, /falar com (uma )?pessoa/i,
  /atendente.{0,12}(humano|de verdade|real)/i, /\burgent/i,
]

function normalizar(texto: string): string {
  return texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export function precisaRevisar(texto: string): boolean {
  const normalizado = normalizar(texto)
  for (const pattern of KEYWORDS) {
    if (pattern.test(normalizado)) return true
  }
  return false
}
