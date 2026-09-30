// Forma canônica do número BR: 55 + DDD (2) + 9 + 8 dígitos para celular.
// Garante o prefixo 55 e injeta o nono dígito quando vier sem ele (número
// antigo de 12 dígitos), para que 5511987654321 e 551187654321 colapsem
// na mesma chave de conversa.
export function normalizarNumero(numero: string): string {
  let digitos = numero.replace(/\D/g, '')
  if (!digitos.startsWith('55')) digitos = '55' + digitos

  if (digitos.length === 12) {
    const ddd = digitos.slice(2, 4)
    const local = digitos.slice(4)
    // Celular BR (pós-Anatel) começa com 9. Se o número local de 8 dígitos
    // começa em 6-9, é celular antigo sem o nono — adicionamos.
    if (/^[6-9]/.test(local)) {
      digitos = '55' + ddd + '9' + local
    }
  }
  return digitos
}
