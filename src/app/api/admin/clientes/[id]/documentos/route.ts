import { NextResponse } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { isAdminAuthed } from '@/lib/admin/guard'
import { registrarEvento, resumoErro } from '@/lib/eventos'
import {
  LIMITE_DOCUMENTO_BYTES,
  LIMITE_NOME_DOCUMENTO,
  prepararParaBusca,
  type StatusDocumento,
} from '@/lib/documentos'

// Upload de documento do cliente (T14): só PDF, até 10 MB, nome único no cliente. Grava
// no banco, sobe para a pasta de busca na OpenAI e espera ficar buscável. Começa sem
// poder ser enviado.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { id } = await ctx.params
  const erro = (status: number, message: string) =>
    NextResponse.json({ error: 'invalid_payload', message }, { status })

  if (Number(req.headers.get('content-length') ?? '0') > LIMITE_DOCUMENTO_BYTES + 64 * 1024) {
    return erro(413, 'O PDF passa de 10 MB.')
  }

  let arquivo: File
  let nome: string
  try {
    const form = await req.formData()
    const valor = form.get('arquivo')
    if (!(valor instanceof File)) throw new Error('arquivo ausente')
    arquivo = valor
    const nomeInformado = String(form.get('nome') ?? '').trim()
    nome = (nomeInformado || arquivo.name.replace(/\.pdf$/i, '')).replace(/\s+/g, ' ').trim()
  } catch {
    return erro(400, 'Envie um arquivo PDF.')
  }
  if (arquivo.size === 0) return erro(400, 'O arquivo está vazio.')
  if (arquivo.size > LIMITE_DOCUMENTO_BYTES) return erro(413, 'O PDF passa de 10 MB.')
  if (!nome) return erro(400, 'Dê um nome ao documento.')
  if (nome.length > LIMITE_NOME_DOCUMENTO) {
    return erro(400, `O nome pode ter até ${LIMITE_NOME_DOCUMENTO} caracteres.`)
  }

  const conteudo = Buffer.from(await arquivo.arrayBuffer())
  if (conteudo.subarray(0, 5).toString('latin1') !== '%PDF-') return erro(400, 'O arquivo não é um PDF.')

  const cliente = await prisma.cliente.findUnique({ where: { id }, select: { id: true } })
  if (!cliente) {
    return NextResponse.json({ error: 'not_found', message: 'Cliente não encontrado.' }, { status: 404 })
  }

  const arquivoNome = /\.pdf$/i.test(arquivo.name) ? arquivo.name : `${nome}.pdf`
  let docId: string
  try {
    const doc = await prisma.documento.create({
      data: { clienteId: id, nome, arquivoNome, tamanho: conteudo.length, conteudo },
      select: { id: true },
    })
    docId = doc.id
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return erro(409, `Já existe um documento chamado "${nome}" neste cliente.`)
    }
    throw e
  }

  let status: StatusDocumento
  try {
    status = await prepararParaBusca(docId)
  } catch (err) {
    logger.error('documentos: falha ao subir para a OpenAI', {
      documentoId: docId,
      erro: err instanceof Error ? err.message : String(err),
    })
    await prisma.documento.update({ where: { id: docId }, data: { status: 'falha' } })
    await registrarEvento('documento_falha_upload', {
      clienteId: id,
      detalhe: { documentoId: docId, ...resumoErro(err) },
    })
    return NextResponse.json({ ok: true, id: docId, status: 'falha' })
  }
  // A OpenAI aceitou o arquivo, mas não achou texto (PDF escaneado) ou não processou
  if (status === 'falha') {
    await registrarEvento('documento_falha_upload', {
      clienteId: id,
      detalhe: { documentoId: docId, motivo: 'sem_texto_ou_recusado' },
    })
  }
  return NextResponse.json({ ok: true, id: docId, status })
}
