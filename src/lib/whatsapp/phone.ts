export function normalizarNumero(numero: string): string {
  const digitos = numero.replace(/\D/g, '')
  if (digitos.startsWith('55')) return digitos
  return '55' + digitos
}
