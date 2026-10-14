import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { getAiConfig } from '@/lib/ai/config'
import { carregarDocumentos } from '@/lib/documentos'
import { VERSAO_PROMPT } from '@/lib/ai/build-prestador-prompt'
import { responderMensagem } from '@/lib/atendimento/motor'
import { nomeDoPedido, portaMemoria } from '@/lib/atendimento/encaminhamento'
import { LIMITE_HISTORICO } from '@/lib/whatsapp/conversa'
import type { ContextoRegistro } from '@/lib/ai/registro'
import { bateriaAutorizada, naoEncontrado } from '@/lib/bateria/acesso'

// Bateria (T6): uma resposta do Concierge com o mesmo motor e o mesmo cérebro do
// link de teste. O histórico vem do script e nada é gravado nas mensagens de teste:
// a bateria não aparece nas conversas do cliente nem conta no limite do link.
// Só o registro técnico fica, com a origem "bateria".
const LIMITE_CORPO_BYTES = 200_000

const Corpo = z.object({
  historico: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        texto: z.string().max(4000),
      }),
    )
    .max(200),
  mensagem: z.string().min(1).max(4000),
  // Encaminhamentos das rodadas anteriores da conversa simulada (T9). Nada vai
  // para o banco: o script guarda e reenvia, para a IA ver o estado e o limite valer.
  encaminhamentos: z
    .array(
      z.object({
        // T10: novo, atualização ou cancelamento. Sem tipo = novo (roteiro anterior à T10)
        tipo: z.enum(['novo', 'atualizacao', 'cancelamento']).default('novo'),
        campos: z.array(z.object({ nome: z.string().max(80), valor: z.string().max(300) })).max(30),
        intencao: z.string().max(300).nullable(),
        resumo: z.string().max(1000).nullable(),
        mudou: z.string().max(300).nullable().default(null),
        em: z.iso.datetime(),
      }),
    )
    .max(20)
    .default([]),
})

function infoProvedor(): { provedor: string | null; modelo: string | null } {
  try {
    const { provider, model } = getAiConfig()
    return { provedor: provider, modelo: model }
  } catch {
    return { provedor: null, modelo: null }
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!bateriaAutorizada(req)) return naoEncontrado()
  const { id } = await ctx.params

  const bruto = await req.text()
  if (bruto.length > LIMITE_CORPO_BYTES) {
    return NextResponse.json({ error: 'too_large' }, { status: 413 })
  }
  let corpo: z.infer<typeof Corpo>
  try {
    corpo = Corpo.parse(JSON.parse(bruto))
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  const cliente = await prisma.cliente.findUnique({
    where: { id },
    select: { id: true, cerebro: true, camposPedido: true, modo: true, canaisFallback: true },
  })
  if (!cliente) return naoEncontrado()

  const contexto: ContextoRegistro = { origem: 'bateria', clienteId: cliente.id }
  // Mesma janela de histórico do WhatsApp e do link de teste
  const historico = corpo.historico.slice(-LIMITE_HISTORICO).map((m) => ({
    role: m.role,
    content: m.texto,
  }))

  const anteriores = corpo.encaminhamentos.map((e) => ({
    tipo: e.tipo,
    campos: e.campos,
    intencao: e.intencao,
    resumo: e.resumo,
    mudou: e.mudou,
    createdAt: new Date(e.em),
  }))
  const { mensagem, bloqueio, encaminhamentos, resultadosFerramenta, documentosEnviados, buscas } =
    await responderMensagem({
    cerebro: cliente.cerebro,
    mensagens: [corpo.mensagem.trim()],
    ehPrimeiraMensagem: corpo.historico.length === 0,
    origemAnuncio: false,
    carregarHistorico: async () => historico,
    contexto,
    cadastro: { modo: cliente.modo, canaisFallback: cliente.canaisFallback },
    encaminhamento: { camposPedido: cliente.camposPedido, porta: portaMemoria(anteriores) },
    // Mesmos documentos do WhatsApp e do link de teste (T14); nada é enviado
    documentos: await carregarDocumentos(cliente.id),
  })
  // O card avaliado é o do encaminhamento novo; atualizações e cancelamentos vão em
  // "registrados", para o roteiro reenviar na rodada seguinte
  const registrado = encaminhamentos.findLast((e) => e.tipo === 'novo') ?? null

  logger.info('bateria: resposta', { clienteId: cliente.id, bloqueio })

  return NextResponse.json({
    texto: mensagem,
    encaminhou: registrado !== null,
    // Resultado das chamadas da ferramenta no turno ("registrado", "faltando: data"...)
    motivo: resultadosFerramenta.join('; ') || null,
    leadNome: registrado ? nomeDoPedido(registrado.campos) : null,
    leadIntencao: registrado?.intencao ?? null,
    leadResumo: registrado?.resumo ?? null,
    campos: registrado?.campos ?? null,
    registrados: encaminhamentos.map((e) => ({
      tipo: e.tipo,
      campos: e.campos,
      intencao: e.intencao,
      resumo: e.resumo,
      mudou: e.mudou,
    })),
    // Documentos (T14): o que a IA mandou enviar e o que achou em cada busca
    documentos: documentosEnviados.map((d) => d.nome),
    buscas: buscas.map((b) => (b.trechos ? b.documentos.join(', ') : 'sem resultado')),
    bloqueio,
    ...infoProvedor(),
    versaoPrompt: VERSAO_PROMPT,
  })
}
