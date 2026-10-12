import { NextResponse } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { isAdminAuthed } from '@/lib/admin/guard'
import { validarCadastro } from '@/lib/admin/cadastro'
import { erroDeGravacao } from '@/lib/admin/erros-cadastro'

// Cria um cliente pelo admin (T8). Nasce como prospect; o link de teste é gerado
// pelo banco (testeToken) e fica bloqueado até ser liberado na lista de clientes.
export async function POST(req: Request) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

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

  try {
    const criado = await prisma.cliente.create({
      data: {
        ...resto,
        cerebro: cerebro as Prisma.InputJsonValue,
        camposPedido: camposPedido as Prisma.InputJsonValue,
        canaisFallback: canaisFallback as Prisma.InputJsonValue,
        status: 'prospect',
      },
      select: { id: true },
    })
    return NextResponse.json({ ok: true, id: criado.id })
  } catch (e) {
    const erro = erroDeGravacao(e)
    if (erro) return NextResponse.json(erro.corpo, { status: erro.status })
    throw e
  }
}
