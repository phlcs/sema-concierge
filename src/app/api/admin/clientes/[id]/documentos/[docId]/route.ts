import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isAdminAuthed } from '@/lib/admin/guard'
import { apagarNaOpenAI } from '@/lib/documentos'

type Ctx = { params: Promise<{ id: string; docId: string }> }

// Liga ou desliga "pode ser enviado" (T14)
export async function PATCH(req: Request, ctx: Ctx) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { id, docId } = await ctx.params
  let podeEnviar: unknown
  try {
    podeEnviar = ((await req.json()) as { podeEnviar?: unknown })?.podeEnviar
  } catch {
    podeEnviar = undefined
  }
  if (typeof podeEnviar !== 'boolean') {
    return NextResponse.json({ error: 'invalid_payload', message: 'Corpo inválido.' }, { status: 400 })
  }
  const { count } = await prisma.documento.updateMany({
    where: { id: docId, clienteId: id },
    data: { podeEnviar },
  })
  if (count === 0) {
    return NextResponse.json({ error: 'not_found', message: 'Documento não encontrado.' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}

// Exclui o documento do banco e, sem travar, da OpenAI (T14)
export async function DELETE(_req: Request, ctx: Ctx) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { id, docId } = await ctx.params
  const doc = await prisma.documento.findFirst({
    where: { id: docId, clienteId: id },
    select: { openaiFileId: true, cliente: { select: { vectorStoreId: true } } },
  })
  if (!doc) {
    return NextResponse.json({ error: 'not_found', message: 'Documento não encontrado.' }, { status: 404 })
  }
  await prisma.documento.delete({ where: { id: docId } })
  await apagarNaOpenAI({ vectorStoreId: doc.cliente.vectorStoreId, openaiFileId: doc.openaiFileId })
  return NextResponse.json({ ok: true })
}
