// Marcador gravado no histórico quando um documento é enviado (T14), para a IA saber no
// próximo turno o que já mandou. Fica num arquivo sem dependências para a tela do link
// de teste também poder importar.
export const PREFIXO_DOCUMENTO = '[documento enviado] '

export function marcadorDocumento(nome: string): string {
  return `${PREFIXO_DOCUMENTO}${nome}`
}
