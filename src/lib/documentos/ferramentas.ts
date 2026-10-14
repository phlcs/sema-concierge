import type { DefinicaoFerramenta } from '@/lib/ai/ferramentas'
import { registrarResposta, USO_VAZIO, type ContextoRegistro } from '@/lib/ai/registro'
import { registrarEvento, resumoErro } from '@/lib/eventos'
import { logger } from '@/lib/logger'
import { buscarNosDocumentos, type DocumentosDoCliente, type Trecho } from './index'

// Ferramentas de documentos (T14): buscar_documentos consulta os PDFs do cliente;
// enviar_documento manda um PDF marcado como "pode ser enviado". O envio em si fica
// com cada porta (WhatsApp manda o arquivo, link de teste mostra o anexo, bateria anota).

export const FERRAMENTA_BUSCAR = 'buscar_documentos'
export const FERRAMENTA_ENVIAR = 'enviar_documento'

// Teto técnico de buscas por resposta, só contra repetição infinita
export const MAX_BUSCAS_POR_RESPOSTA = 5
// Trecho que vai para o evento "Documento consultado" e para o registro técnico
const TRECHO_EVENTO = 300

export type DocumentoEnviado = { id: string; nome: string }

export type ResultadoBusca = { documentos: string[]; trechos: number }

function prontos(docs: DocumentosDoCliente) {
  return docs.lista.filter((d) => d.status === 'pronto' && d.openaiFileId)
}

export function enviaveis(docs: DocumentosDoCliente) {
  return prontos(docs).filter((d) => d.podeEnviar)
}

export function temBusca(docs: DocumentosDoCliente): boolean {
  return docs.vectorStoreId !== null && prontos(docs).length > 0
}

export function definicoesDocumentos(docs: DocumentosDoCliente): DefinicaoFerramenta[] {
  const definicoes: DefinicaoFerramenta[] = []
  if (temBusca(docs)) {
    definicoes.push({
      nome: FERRAMENTA_BUSCAR,
      descricao: `Busca nos documentos do negócio (listados em <documentos>) e devolve os trechos mais parecidos com a consulta. Chame sempre que a pessoa perguntar um fato do negócio que não está em <cerebro> (prato, ingrediente, item, preço, regra, cláusula, detalhe de serviço), ANTES de dizer que não sabe. Pode chamar de novo com outras palavras se o primeiro resultado não responder. Use só o que os trechos dizem, sem completar de cabeça; se nenhum trecho responder à pergunta, trate como informação que você não tem. Responde com os trechos, "nenhum resultado" ou "limite de buscas".`,
      parametros: {
        type: 'object',
        properties: {
          consulta: {
            type: 'string',
            description: 'O que procurar, em português, em poucas palavras (ex.: "ingredientes do risoto de camarão")',
          },
        },
        required: ['consulta'],
      },
    })
  }
  const lista = enviaveis(docs)
  if (lista.length > 0) {
    definicoes.push({
      nome: FERRAMENTA_ENVIAR,
      descricao: `Envia um documento do negócio (PDF) para a pessoa nesta conversa. Chame quando a pessoa pedir o documento (ex.: "me manda o cardápio") ou quando mandar o arquivo for a melhor resposta. Só existem os documentos desta lista; nunca prometa outro. Responde "enviado" (o arquivo chega logo depois da sua resposta: diga em uma frase curta que está mandando, sem colar link) ou "indisponível". Não envie o mesmo documento de novo se ele já foi enviado nesta conversa, a não ser que a pessoa peça.`,
      parametros: {
        type: 'object',
        properties: {
          documento: {
            type: 'string',
            enum: lista.map((d) => d.nome),
            description: 'Nome do documento, exatamente como na lista',
          },
        },
        required: ['documento'],
      },
    })
  }
  return definicoes
}

function textoDosTrechos(trechos: Trecho[]): string {
  const linhas = trechos.map((t, i) => `[${i + 1}] Documento "${t.documento}":\n${t.texto}`)
  return `Trechos encontrados. Use só o que responder à pergunta; se nenhum responder, trate como informação que você não tem.\n\n${linhas.join('\n\n')}`
}

// Executor das ferramentas de documentos de UMA resposta (as contagens são do turno).
// Devolve null quando o nome não é de documento, para o motor tentar outra ferramenta.
export function executorDocumentos(args: {
  docs: DocumentosDoCliente
  contexto: ContextoRegistro
  aoEnviar: (doc: DocumentoEnviado) => void
  aoBuscar: (resultado: ResultadoBusca) => void
}): (nome: string, pedido: unknown) => Promise<string | null> {
  const { docs, contexto } = args
  let buscas = 0
  const enviados = new Set<string>()
  const nomes = new Map(prontos(docs).map((d) => [d.openaiFileId!, d.nome]))
  const detalhe = {
    origem: contexto.origem,
    conversaId: contexto.conversaId ?? null,
    demoId: contexto.demoId ?? null,
  }

  async function buscar(pedido: unknown): Promise<string> {
    const consulta = String((pedido as { consulta?: unknown } | null)?.consulta ?? '').trim()
    if (!consulta) return 'erro: mande a consulta (o que procurar).'
    if (!docs.vectorStoreId || !temBusca(docs)) return 'nenhum resultado'
    if (buscas >= MAX_BUSCAS_POR_RESPOSTA) {
      return 'limite de buscas: não busque mais nesta resposta. Responda com o que já tem; o que não encontrou, trate como informação que você não tem.'
    }
    buscas += 1
    const inicio = Date.now()
    try {
      const trechos = await buscarNosDocumentos({ vectorStoreId: docs.vectorStoreId, consulta, nomes })
      const documentos = [...new Set(trechos.map((t) => t.documento))]
      args.aoBuscar({ documentos, trechos: trechos.length })
      await Promise.all([
        registrarResposta({
          contexto,
          funcao: 'busca_documentos',
          provedor: 'openai',
          modelo: 'vector_store_search',
          uso: USO_VAZIO,
          tempoMs: Date.now() - inicio,
          custoEstimadoUsd: null,
          ferramentas: trechos.map((t) => ({
            nome: t.documento,
            resultado: `${t.relevancia.toFixed(2)} ${t.texto.slice(0, TRECHO_EVENTO)}`,
          })),
          sucesso: true,
        }),
        trechos.length === 0
          ? registrarEvento('busca_sem_resultado', { clienteId: contexto.clienteId, detalhe })
          : registrarEvento('documento_consultado', {
              clienteId: contexto.clienteId,
              detalhe: {
                ...detalhe,
                documentos: documentos.join(', '),
                trechos: trechos.length,
                trecho: `${trechos[0].documento}: ${trechos[0].texto.slice(0, TRECHO_EVENTO)}`,
              },
            }),
      ])
      if (trechos.length === 0) {
        return 'nenhum resultado: os documentos não falam disso. Não afirme; se também não estiver em <cerebro>, diga que não tem essa informação e siga o papel do encaminhamento do seu modo.'
      }
      return textoDosTrechos(trechos)
    } catch (err) {
      logger.error('documentos: falha na busca', {
        erro: err instanceof Error ? err.message : String(err),
      })
      await Promise.all([
        registrarEvento('busca_falha', {
          clienteId: contexto.clienteId,
          detalhe: { ...detalhe, ...resumoErro(err) },
        }),
        registrarResposta({
          contexto,
          funcao: 'busca_documentos',
          provedor: 'openai',
          modelo: 'vector_store_search',
          uso: USO_VAZIO,
          tempoMs: Date.now() - inicio,
          custoEstimadoUsd: null,
          sucesso: false,
        }),
      ])
      return 'erro: a busca nos documentos falhou agora. Não afirme nada que não esteja em <cerebro>.'
    }
  }

  function enviar(pedido: unknown): string {
    const nome = String((pedido as { documento?: unknown } | null)?.documento ?? '').trim()
    const doc = enviaveis(docs).find((d) => d.nome === nome)
    if (!doc) return 'indisponível: esse documento não existe ou não pode ser enviado. Não prometa enviar.'
    if (!enviados.has(doc.id)) {
      enviados.add(doc.id)
      args.aoEnviar({ id: doc.id, nome: doc.nome })
    }
    return 'enviado'
  }

  return async (nome, pedido) => {
    if (nome === FERRAMENTA_BUSCAR) return buscar(pedido)
    if (nome === FERRAMENTA_ENVIAR) return enviar(pedido)
    return null
  }
}
