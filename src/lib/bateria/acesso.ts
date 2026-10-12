import { NextResponse } from 'next/server'
import { safeEqual } from '@/lib/admin/senha'

// Bateria de personas (T6): acesso próprio, separado do link de teste público.
// Só funciona com BATERIA_TOKEN configurado (mínimo de 32 caracteres) e enviado
// no cabeçalho "Authorization: Bearer <senha>". Sem a variável, a porta fica desligada.
const TAMANHO_MINIMO = 32

export function bateriaAutorizada(req: Request): boolean {
  const esperada = process.env.BATERIA_TOKEN ?? ''
  if (esperada.length < TAMANHO_MINIMO) return false
  const cabecalho = req.headers.get('authorization') ?? ''
  if (!cabecalho.startsWith('Bearer ')) return false
  return safeEqual(cabecalho.slice('Bearer '.length).trim(), esperada)
}

// Qualquer recusa responde igual a uma rota inexistente: não revela que a porta existe
export function naoEncontrado(): NextResponse {
  return NextResponse.json({ error: 'not_found' }, { status: 404 })
}
