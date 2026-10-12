import { z } from 'zod'
import { lerCerebro } from '@/lib/cerebro/chaves'

// Cadastro do cliente (T8): campos de funcionamento que ficam fora do cérebro.
// Usado pela tela (tipos e opções) e pelas rotas de criar e editar (validação).

export const MODOS = [
  { valor: 'conversao', rotulo: 'Conversão' },
  { valor: 'hospitalidade', rotulo: 'Hospitalidade' },
  { valor: 'resolucao', rotulo: 'Resolução' },
] as const

export const DESTINOS = [{ valor: 'email', rotulo: 'E-mail' }] as const

export const TIPOS_CANAL = [
  { valor: 'email', rotulo: 'E-mail' },
  { valor: 'telefone', rotulo: 'Telefone' },
  { valor: 'whatsapp', rotulo: 'WhatsApp' },
  { valor: 'outro', rotulo: 'Outro' },
] as const

// Canais por tipo de desvio (opcionais). O principal é obrigatório.
export const CANAIS_DESVIO = [
  { chave: 'sac', rotulo: 'SAC (reclamações)' },
  { chave: 'rh', rotulo: 'RH (vagas)' },
  { chave: 'compras', rotulo: 'Compras (fornecedores)' },
  { chave: 'imprensa', rotulo: 'Imprensa ou parcerias' },
  { chave: 'urgencia', rotulo: 'Contato rápido (urgências)' },
] as const

export type ChaveDesvio = (typeof CANAIS_DESVIO)[number]['chave']
export type Canal = { tipo: string; contato: string }
export type CanaisFallback = { principal?: Canal } & Partial<Record<ChaveDesvio, Canal>>
export type CampoPedido = { nome: string; obrigatorio: boolean }

export function remetentePadrao(nomeNegocio: string): string {
  return `Concierge ${nomeNegocio.trim()}`.trim()
}

const texto = (max: number) => z.string().trim().max(max)
const opcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null))

const tipoCanal = z.enum(TIPOS_CANAL.map((t) => t.valor) as [string, ...string[]], {
  message: 'Tipo de canal inválido.',
})
const canal = z.object({ tipo: tipoCanal, contato: texto(200) })

const CadastroSchema = z.object({
  nomeNegocio: texto(120).min(1, 'Informe o nome do negócio.'),
  cerebro: z.string(),
  modo: z.enum(MODOS.map((m) => m.valor) as [string, ...string[]], {
    message: 'Escolha o modo.',
  }),
  camposPedido: z
    .array(z.object({ nome: texto(80), obrigatorio: z.boolean() }))
    .max(30, 'No máximo 30 campos do pedido.'),
  emailPrestador: z.email('E-mail que recebe os encaminhamentos inválido.').trim().max(200),
  nomeRemetente: opcional(120),
  destinoEncaminhamento: z.enum(DESTINOS.map((d) => d.valor) as [string, ...string[]], {
    message: 'Destino inválido.',
  }),
  canaisFallback: z.object({
    principal: canal,
    ...Object.fromEntries(CANAIS_DESVIO.map((c) => [c.chave, canal.optional()])),
  }),
  phoneNumberId: opcional(64),
  wabaId: opcional(64),
  numeroExibicao: opcional(40),
})

export type DadosCadastro = {
  nomeNegocio: string
  cerebro: Record<string, unknown>
  modo: string
  camposPedido: CampoPedido[]
  emailPrestador: string
  nomeRemetente: string
  destinoEncaminhamento: string
  canaisFallback: CanaisFallback
  phoneNumberId: string | null
  wabaId: string | null
  numeroExibicao: string | null
}

// Valida o corpo enviado pela tela. Devolve os dados prontos para gravar ou a
// primeira mensagem de erro, em português.
export function validarCadastro(
  body: unknown,
): { ok: true; dados: DadosCadastro } | { ok: false; erro: string } {
  const r = CadastroSchema.safeParse(body)
  if (!r.success) {
    return { ok: false, erro: r.error.issues[0]?.message ?? 'Dados inválidos.' }
  }
  const d = r.data

  const cerebro = lerCerebro(d.cerebro)
  if (!cerebro.ok) return { ok: false, erro: cerebro.erro }

  const camposPedido = d.camposPedido.filter((c) => c.nome)
  const nomes = camposPedido.map((c) => c.nome.toLowerCase())
  const repetido = nomes.find((n, i) => nomes.indexOf(n) !== i)
  if (repetido) return { ok: false, erro: `Campo do pedido repetido: ${repetido}` }

  const fallback = d.canaisFallback as Record<string, Canal | undefined>
  if (!fallback.principal?.contato) {
    return { ok: false, erro: 'Informe o canal principal de fallback (o contato).' }
  }
  // Canal de desvio sem contato é tratado como não preenchido
  const canaisFallback: CanaisFallback = { principal: fallback.principal }
  for (const { chave } of CANAIS_DESVIO) {
    const c = fallback[chave]
    if (c?.contato) canaisFallback[chave] = c
  }

  return {
    ok: true,
    dados: {
      nomeNegocio: d.nomeNegocio,
      cerebro: cerebro.cerebro,
      modo: d.modo,
      camposPedido,
      emailPrestador: d.emailPrestador,
      nomeRemetente: d.nomeRemetente ?? remetentePadrao(d.nomeNegocio),
      destinoEncaminhamento: d.destinoEncaminhamento,
      canaisFallback,
      phoneNumberId: d.phoneNumberId,
      wabaId: d.wabaId,
      numeroExibicao: d.numeroExibicao,
    },
  }
}
