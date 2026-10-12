import { NextResponse } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { isAdminAuthed } from '@/lib/admin/guard'
import { validarCadastro } from '@/lib/admin/cadastro'
import { erroDeGravacao } from '@/lib/admin/erros-cadastro'

// Edita o cadastro do cliente (T8): nome, cérebro e campos de funcionamento.
// Status e link de teste continuam nos botões da lista de clientes.
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { id } = await ctx.params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: 'invalid_body', message: 'Corpo da requisição inválido.' },
      { status: 400 },
    )
  }

  const r = validarCadastro(body)
  if (!r.ok) {
    return NextResponse.json({ error: 'invalid_payload', message: r.erro }, { status: 400 })
  }
  const { cerebro, camposPedido, canaisFallback, ...resto } = r.dados

  const atual = await prisma.cliente.findUnique({ where: { id }, select: { status: true } })
  if (!atual) {
    return NextResponse.json({ error: 'not_found', message: 'Cliente não encontrado.' }, { status: 404 })
  }
  // Cliente ativo sem ID do número deixaria de receber mensagens sem aviso
  if (atual.status !== 'prospect' && !resto.phoneNumberId) {
    return NextResponse.json(
      {
        error: 'invalid_payload',
        message: 'Cliente ativo precisa do ID do número na Meta. Sem ele, o WhatsApp para de responder.',
      },
      { status: 400 },
    )
  }

  try {
    await prisma.cliente.update({
      where: { id },
      data: {
        ...resto,
        cerebro: cerebro as Prisma.InputJsonValue,
        camposPedido: camposPedido as Prisma.InputJsonValue,
        canaisFallback: canaisFallback as Prisma.InputJsonValue,
      },
    })
  } catch (e) {
    const erro = erroDeGravacao(e)
    if (erro) return NextResponse.json(erro.corpo, { status: erro.status })
    throw e
  }

  return NextResponse.json({ ok: true })
}
