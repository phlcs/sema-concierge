import { prisma } from '@/lib/prisma'
import type { CampoPedido } from '@/lib/admin/cadastro'
import type { DefinicaoFerramenta } from '@/lib/ai/ferramentas'
import { formatarDataHoraBrasilia, inicioDoDiaBrasilia } from '@/lib/ai/build-prestador-prompt'

// Encaminhamento como ferramenta (T9). A IA chama registrar_pedido com o que tem;
// o código confere os campos obrigatórios e o limite do dia e devolve o resultado.
// Só depois a IA escreve a resposta ao lead.

export const NOME_FERRAMENTA = 'registrar_pedido'

// Encaminhamentos novos por dia por conversa, no dia do calendário de Brasília
export const LIMITE_DIARIO = 3

// Cliente sem lista de campos (anterior à T8): só o nome é obrigatório, como antes
const CAMPOS_PADRAO: CampoPedido[] = [{ nome: 'nome', obrigatorio: true }]

export type CampoPreenchido = { nome: string; valor: string }

export type EncaminhamentoFeito = {
  campos: CampoPreenchido[]
  intencao: string | null
  resumo: string | null
  createdAt: Date
}

export type NovoEncaminhamento = Omit<EncaminhamentoFeito, 'createdAt'>

// Onde cada porta guarda os encaminhamentos: WhatsApp por conversa, link de teste
// por sessão, bateria em memória.
export type PortaEncaminhamento = {
  // Os mais recentes da conversa, do mais antigo para o mais novo
  listar: () => Promise<EncaminhamentoFeito[]>
  registrar: (novo: NovoEncaminhamento) => Promise<void>
}

export type ResultadoPedido =
  | { tipo: 'registrado'; encaminhamento: NovoEncaminhamento }
  | { tipo: 'faltando'; campos: string[] }
  | { tipo: 'limite' }
  | { tipo: 'invalido' }

const LISTAR_ULTIMOS = 20

export function lerCamposPedido(valor: unknown): CampoPedido[] {
  const lista = Array.isArray(valor)
    ? valor.filter(
        (c): c is CampoPedido =>
          !!c && typeof c === 'object' && typeof (c as CampoPedido).nome === 'string' && (c as CampoPedido).nome.trim() !== '',
      )
    : []
  return lista.length > 0 ? lista.map((c) => ({ nome: c.nome.trim(), obrigatorio: c.obrigatorio === true })) : CAMPOS_PADRAO
}

export function definicaoFerramenta(campos: CampoPedido[]): DefinicaoFerramenta {
  const lista = campos
    .map((c) => `- ${c.nome}${c.obrigatorio ? ' (obrigatório)' : ' (opcional)'}`)
    .join('\n')
  return {
    nome: NOME_FERRAMENTA,
    descricao: `Registra o pedido da pessoa e encaminha para a equipe do negócio. Chame quando a conversa chegar no ponto de encaminhar. Responde "registrado", "faltando: X" (peça X à pessoa) ou "limite atingido" (não prometa retorno).
Campos do pedido, use exatamente estes nomes como chaves em "campos":
${lista}
Preencha só o que a pessoa disse ou confirmou; não invente. Data só vale se for um dia específico: data vaga ("semana que vem", "qualquer dia") fica vazia. Tudo em português.`,
    parametros: {
      type: 'object',
      properties: {
        campos: {
          type: 'object',
          description: 'Valores dos campos do pedido, com os nomes da lista como chaves',
          properties: Object.fromEntries(campos.map((c) => [c.nome, { type: 'string' }])),
          additionalProperties: { type: 'string' },
        },
        intencao: { type: 'string', description: 'Em uma linha, o que a pessoa quer' },
        resumo: {
          type: 'string',
          description: '2 a 3 linhas de contexto útil para a equipe agir, sem floreio',
        },
      },
      required: ['campos', 'intencao', 'resumo'],
    },
  }
}

function texto(valor: unknown): string {
  if (typeof valor === 'string') return valor.trim()
  if (typeof valor === 'number') return String(valor)
  return ''
}

// Valores vazios ou que só dizem que não sabe contam como faltando
const VAZIO = /^(-|n\/?a|null|nenhum|nenhuma|não informado|nao informado|não sei|nao sei|\?+)$/i

// Confere o pedido sem gravar. `feitosHoje` = encaminhamentos novos da conversa desde a meia-noite.
export function conferirPedido(args: {
  campos: CampoPedido[]
  pedido: unknown
  feitosHoje: number
}): ResultadoPedido {
  const { campos, pedido, feitosHoje } = args
  if (!pedido || typeof pedido !== 'object') return { tipo: 'invalido' }
  const p = pedido as Record<string, unknown>
  const recebidos =
    p.campos && typeof p.campos === 'object' && !Array.isArray(p.campos)
      ? (p.campos as Record<string, unknown>)
      : {}
  // A IA pode variar maiúsculas; o nome do cadastro é o que vale
  const porNome = new Map(Object.entries(recebidos).map(([k, v]) => [k.trim().toLowerCase(), texto(v)]))

  const preenchidos: CampoPreenchido[] = []
  const faltando: string[] = []
  for (const c of campos) {
    const valor = porNome.get(c.nome.toLowerCase()) ?? ''
    const vazio = valor === '' || VAZIO.test(valor)
    if (vazio && c.obrigatorio) faltando.push(c.nome)
    if (!vazio) preenchidos.push({ nome: c.nome, valor: valor.slice(0, 300) })
  }
  if (faltando.length > 0) return { tipo: 'faltando', campos: faltando }
  if (feitosHoje >= LIMITE_DIARIO) return { tipo: 'limite' }

  return {
    tipo: 'registrado',
    encaminhamento: {
      campos: preenchidos,
      intencao: texto(p.intencao).slice(0, 300) || null,
      resumo: texto(p.resumo).slice(0, 1000) || null,
    },
  }
}

export function textoDoResultado(r: ResultadoPedido): string {
  switch (r.tipo) {
    case 'registrado':
      return 'registrado'
    case 'faltando':
      return `faltando: ${r.campos.join(', ')}`
    case 'limite':
      return 'limite atingido'
    default:
      return 'erro: chame de novo com "campos", "intencao" e "resumo"'
  }
}

export function contarDesde(feitos: EncaminhamentoFeito[], desde: Date): number {
  return feitos.filter((f) => f.createdAt.getTime() >= desde.getTime()).length
}

// Estado do encaminhamento para os dados do momento: o que já foi feito na
// conversa e quantos novos hoje, com aviso quando o limite foi atingido.
export function blocoEstado(feitos: EncaminhamentoFeito[], agora: Date): string {
  const hoje = contarDesde(feitos, inicioDoDiaBrasilia(agora))
  const linhas = feitos.map((f) => {
    const campos = f.campos.map((c) => `${c.nome}: ${c.valor}`).join('; ')
    return `- ${formatarDataHoraBrasilia(f.createdAt)}: ${campos || '(sem campos)'}${f.intencao ? ` (${f.intencao})` : ''}`
  })
  const aviso =
    hoje >= LIMITE_DIARIO
      ? `\nLIMITE ATINGIDO: hoje já foram ${hoje} encaminhamentos novos nesta conversa. Não chame a ferramenta de novo hoje; se a pessoa trouxer outro pedido, diga com leveza que amanhã consegue registrar.`
      : ''
  return `<estado_encaminhamento>
# ENCAMINHAMENTOS DESTA CONVERSA
${linhas.length > 0 ? `Já registrados (não registre de novo o mesmo pedido nem repita que vai encaminhar):\n${linhas.join('\n')}` : 'Nenhum encaminhamento registrado nesta conversa ainda.'}
Novos hoje: ${hoje} de ${LIMITE_DIARIO}.${aviso}
</estado_encaminhamento>`
}

function lerCampos(valor: unknown): CampoPreenchido[] {
  return Array.isArray(valor)
    ? valor.filter((c): c is CampoPreenchido => !!c && typeof c === 'object' && typeof c.nome === 'string')
    : []
}

function paraFeito(r: {
  campos: unknown
  intencao: string | null
  resumo: string | null
  createdAt: Date
}): EncaminhamentoFeito {
  return { campos: lerCampos(r.campos), intencao: r.intencao, resumo: r.resumo, createdAt: r.createdAt }
}

const SELECAO = { campos: true, intencao: true, resumo: true, createdAt: true } as const

export function portaWhatsapp(clienteId: string, conversaId: string): PortaEncaminhamento {
  return {
    listar: async () =>
      (
        await prisma.encaminhamento.findMany({
          where: { conversaId },
          orderBy: { createdAt: 'desc' },
          take: LISTAR_ULTIMOS,
          select: SELECAO,
        })
      )
        .reverse()
        .map(paraFeito),
    registrar: async (novo) => {
      await prisma.encaminhamento.create({ data: { clienteId, conversaId, ...novo } })
    },
  }
}

export function portaTeste(clienteId: string, sessaoId: string): PortaEncaminhamento {
  return {
    listar: async () =>
      (
        await prisma.encaminhamento.findMany({
          where: { clienteId, sessaoId },
          orderBy: { createdAt: 'desc' },
          take: LISTAR_ULTIMOS,
          select: SELECAO,
        })
      )
        .reverse()
        .map(paraFeito),
    registrar: async (novo) => {
      await prisma.encaminhamento.create({ data: { clienteId, sessaoId, ...novo } })
    },
  }
}

// Bateria: nada vai para o banco. O roteiro manda os encaminhamentos das rodadas anteriores.
export function portaMemoria(anteriores: EncaminhamentoFeito[]): PortaEncaminhamento {
  const lista = [...anteriores]
  return {
    listar: async () => [...lista],
    registrar: async (novo) => {
      lista.push({ ...novo, createdAt: new Date() })
    },
  }
}

// Nome do contato, para o e-mail e o card: o campo "nome" do pedido, se houver
export function nomeDoPedido(campos: CampoPreenchido[]): string | null {
  return campos.find((c) => /^nome\b/i.test(c.nome))?.valor ?? null
}
