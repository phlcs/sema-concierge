// Chaves que o cérebro pode ter (T8). São as que buildPrestadorPrompt() lê hoje.
// Quando o formato do cérebro mudar (T12/T13), esta lista muda no mesmo commit.
export const CHAVES_CEREBRO = [
  'NOME_ASSISTENTE',
  'NOME_DO_NEGOCIO',
  'NOME_PRESTADOR',
  'PRAZO_RETORNO',
  'RESUMO_NEGOCIO',
  'SERVICOS',
  'PRECOS_GERAIS',
  'HORARIOS',
  'COMO_FUNCIONA',
  'O_QUE_SEMPRE_ESCALA',
  'PERGUNTAS_FREQUENTES',
  'CAMPO_LIVRE',
] as const

const VALIDAS = new Set<string>(CHAVES_CEREBRO)

// Lê o texto do cérebro e confere só os nomes das chaves: sem checagem de tipo
// nem de campo vazio. Devolve o objeto ou uma mensagem de erro em português.
export function lerCerebro(
  texto: string,
): { ok: true; cerebro: Record<string, unknown> } | { ok: false; erro: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(texto)
  } catch (e) {
    const detalhe = e instanceof Error ? e.message : ''
    return { ok: false, erro: `Cérebro não é um JSON válido. ${detalhe}`.trim() }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, erro: 'O cérebro precisa ser um objeto JSON ({ ... }).' }
  }
  const desconhecidas = Object.keys(parsed).filter((k) => !VALIDAS.has(k))
  if (desconhecidas.length > 0) {
    const rotulo = desconhecidas.length === 1 ? 'Chave desconhecida' : 'Chaves desconhecidas'
    return { ok: false, erro: `${rotulo} no cérebro: ${desconhecidas.join(', ')}` }
  }
  return { ok: true, cerebro: parsed as Record<string, unknown> }
}
