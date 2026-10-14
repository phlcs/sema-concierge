import { toFile } from 'openai'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { clienteOpenAI } from '@/lib/ai/chave-openai'

// Documentos do cliente (T14). O PDF fica no banco (para mandar pelo WhatsApp: a OpenAI
// não devolve o arquivo original) e uma cópia vai para a pasta de busca (vector store)
// do cliente na OpenAI, que é a busca pronta usada pela ferramenta buscar_documentos.

export const LIMITE_DOCUMENTO_BYTES = 10 * 1024 * 1024
export const LIMITE_NOME_DOCUMENTO = 60

export type StatusDocumento = 'processando' | 'pronto' | 'falha'

// O que o atendimento precisa saber dos documentos de um cliente (sem o arquivo)
export type DocumentoAtendimento = {
  id: string
  nome: string
  openaiFileId: string | null
  status: string
  podeEnviar: boolean
}

export type DocumentosDoCliente = {
  vectorStoreId: string | null
  lista: DocumentoAtendimento[]
}

export const SELECAO_ATENDIMENTO = {
  id: true,
  nome: true,
  openaiFileId: true,
  status: true,
  podeEnviar: true,
} as const

export async function carregarDocumentos(clienteId: string): Promise<DocumentosDoCliente> {
  const [cliente, lista] = await Promise.all([
    prisma.cliente.findUnique({ where: { id: clienteId }, select: { vectorStoreId: true } }),
    prisma.documento.findMany({
      where: { clienteId },
      orderBy: { createdAt: 'asc' },
      select: SELECAO_ATENDIMENTO,
    }),
  ])
  return { vectorStoreId: cliente?.vectorStoreId ?? null, lista }
}

// Tamanho dos trechos na busca: menores que o padrão (800 tokens), para a IA receber o
// pedaço que interessa e não meia página
const FATIAMENTO = {
  type: 'static' as const,
  static: { max_chunk_size_tokens: 400, chunk_overlap_tokens: 100 },
}
// Quanto o upload espera o processamento antes de devolver "processando"
const ESPERA_PROCESSAMENTO_MS = 90_000

async function garantirVectorStore(clienteId: string): Promise<string> {
  const cliente = await prisma.cliente.findUnique({
    where: { id: clienteId },
    select: { vectorStoreId: true },
  })
  if (cliente?.vectorStoreId) return cliente.vectorStoreId
  const vs = await clienteOpenAI().vectorStores.create({ name: `sema-${clienteId}` })
  // Condicional: se outro upload criou a pasta ao mesmo tempo, fica a primeira
  const { count } = await prisma.cliente.updateMany({
    where: { id: clienteId, vectorStoreId: null },
    data: { vectorStoreId: vs.id },
  })
  if (count === 0) {
    await clienteOpenAI().vectorStores.delete(vs.id).catch(() => undefined)
    const atual = await prisma.cliente.findUnique({
      where: { id: clienteId },
      select: { vectorStoreId: true },
    })
    if (!atual?.vectorStoreId) throw new Error('pasta de busca não encontrada')
    return atual.vectorStoreId
  }
  return vs.id
}

// Situação do arquivo na pasta de busca. PDF sem texto (escaneado) termina sem nada
// indexado: conta como falha.
function statusDaOpenAI(arquivo: { status: string; usage_bytes: number }): StatusDocumento {
  if (arquivo.status === 'completed') return arquivo.usage_bytes > 0 ? 'pronto' : 'falha'
  if (arquivo.status === 'in_progress') return 'processando'
  return 'falha'
}

// Sobe o PDF para a OpenAI e espera ficar buscável (até ESPERA_PROCESSAMENTO_MS).
// Grava o resultado no documento. Lança se a OpenAI recusar.
export async function prepararParaBusca(documentoId: string): Promise<StatusDocumento> {
  const doc = await prisma.documento.findUniqueOrThrow({
    where: { id: documentoId },
    select: { clienteId: true, arquivoNome: true, conteudo: true },
  })
  const openai = clienteOpenAI()
  const vsId = await garantirVectorStore(doc.clienteId)
  const arquivo = await openai.files.create({
    file: await toFile(Buffer.from(doc.conteudo), doc.arquivoNome, { type: 'application/pdf' }),
    purpose: 'assistants',
  })
  await prisma.documento.update({ where: { id: documentoId }, data: { openaiFileId: arquivo.id } })

  await openai.vectorStores.files.create(vsId, { file_id: arquivo.id, chunking_strategy: FATIAMENTO })
  const resultado = await Promise.race([
    openai.vectorStores.files.poll(vsId, arquivo.id),
    new Promise<null>((r) => setTimeout(() => r(null), ESPERA_PROCESSAMENTO_MS)),
  ])
  const status = resultado ? statusDaOpenAI(resultado) : 'processando'
  if (resultado?.last_error) {
    logger.warn('documentos: OpenAI não processou o arquivo', {
      documentoId,
      codigo: resultado.last_error.code,
      mensagem: resultado.last_error.message,
    })
  }
  await prisma.documento.update({ where: { id: documentoId }, data: { status } })
  return status
}

// Documento que ficou "processando" (o upload parou de esperar): pergunta à OpenAI de
// novo. Chamado ao abrir a tela do cliente. Nunca lança.
export async function conferirProcessando(clienteId: string): Promise<void> {
  try {
    const [cliente, pendentes] = await Promise.all([
      prisma.cliente.findUnique({ where: { id: clienteId }, select: { vectorStoreId: true } }),
      prisma.documento.findMany({
        where: { clienteId, status: 'processando', openaiFileId: { not: null } },
        select: { id: true, openaiFileId: true },
      }),
    ])
    if (!cliente?.vectorStoreId || pendentes.length === 0) return
    const openai = clienteOpenAI()
    for (const p of pendentes) {
      const arquivo = await openai.vectorStores.files.retrieve(p.openaiFileId!, {
        vector_store_id: cliente.vectorStoreId,
      })
      const status = statusDaOpenAI(arquivo)
      if (status !== 'processando') {
        await prisma.documento.update({ where: { id: p.id }, data: { status } })
      }
    }
  } catch (err) {
    logger.warn('documentos: falha ao conferir documentos em processamento', {
      clienteId,
      erro: err instanceof Error ? err.message : String(err),
    })
  }
}

// Tira o arquivo da pasta de busca e apaga na OpenAI. Nunca lança: o documento sai do
// banco de qualquer jeito, e a cópia que sobrar na OpenAI fica só no log.
export async function apagarNaOpenAI(args: {
  vectorStoreId: string | null
  openaiFileId: string | null
}): Promise<void> {
  if (!args.openaiFileId) return
  try {
    const openai = clienteOpenAI()
    if (args.vectorStoreId) {
      await openai.vectorStores.files
        .delete(args.openaiFileId, { vector_store_id: args.vectorStoreId })
        .catch(() => undefined)
    }
    await openai.files.delete(args.openaiFileId)
  } catch (err) {
    logger.warn('documentos: não foi possível apagar o arquivo na OpenAI', {
      openaiFileId: args.openaiFileId,
      erro: err instanceof Error ? err.message : String(err),
    })
  }
}

export type Trecho = { documento: string; texto: string; relevancia: number }

const MAX_TRECHOS = 5

// Busca pronta da OpenAI na pasta do cliente. Só devolve trechos de documentos que
// ainda estão no cadastro e prontos (`nomes`: openaiFileId → nome). Lança se a busca falhar.
export async function buscarNosDocumentos(args: {
  vectorStoreId: string
  consulta: string
  nomes: Map<string, string>
}): Promise<Trecho[]> {
  const pagina = await clienteOpenAI().vectorStores.search(
    args.vectorStoreId,
    { query: args.consulta, max_num_results: MAX_TRECHOS, rewrite_query: true },
    { timeout: 15_000 },
  )
  const trechos: Trecho[] = []
  for (const r of pagina.data) {
    const documento = args.nomes.get(r.file_id)
    if (!documento) continue
    const texto = r.content
      .map((c) => c.text)
      .join('\n')
      .trim()
    if (texto) trechos.push({ documento, texto, relevancia: r.score })
  }
  return trechos
}
