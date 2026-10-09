// Só números do Brasil (começam com 55) passam pela regra do nono dígito:
// 55 + DDD (2) + 9 + 8 dígitos para celular. Assim 5511987654321 e
// 551187654321 colapsam na mesma chave de conversa. Qualquer outro número
// é usado exatamente como a Meta enviou (só dígitos), inclusive no envio.
export function normalizarNumero(numero: string): string {
  const digitos = numero.replace(/\D/g, '')
  if (!digitos.startsWith('55')) return digitos

  if (digitos.length === 12) {
    const ddd = digitos.slice(2, 4)
    const local = digitos.slice(4)
    // Celular BR (pós-Anatel) começa com 9. Se o número local de 8 dígitos
    // começa em 6-9, é celular antigo sem o nono — adicionamos.
    if (/^[6-9]/.test(local)) {
      return '55' + ddd + '9' + local
    }
  }
  return digitos
}
