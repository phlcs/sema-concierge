import { prisma } from '@/lib/prisma'
import type { CampoPedido } from '@/lib/admin/cadastro'
import type { DefinicaoFerramenta } from '@/lib/ai/ferramentas'
import { formatarDataHoraBrasilia, inicioDoDiaBrasilia } from '@/lib/ai/build-prestador-prompt'

// Encaminhamento como ferramenta (T9). A IA chama registrar_pedido com o que tem;
// o código confere os campos obrigatórios e o limite do dia e devolve o resultado.
// Só depois a IA escreve a resposta ao lead.
// T10: atualizar_pedido e cancelar_pedido mudam o último pedido ativo da conversa.

export const NOME_FERRAMENTA = 'registrar_pedido'
export const FERRAMENTA_ATUALIZAR = 'atualizar_pedido'
export const FERRAMENTA_CANCELAR = 'cancelar_pedido'

// Encaminhamentos novos por dia por conversa, no dia do calendário de Brasília
export const LIMITE_DIARIO = 3
// Atualizações e cancelamentos por dia por conversa (teto à parte, para a equipe
// não receber uma chuva de e-mails se a IA se confundir)
export const LIMITE_DIARIO_MUDANCAS = 5

// Cliente sem lista de campos (anterior à T8): só o nome é obrigatório, como antes
const CAMPOS_PADRAO: CampoPedido[] = [{ nome: 'nome', obrigatorio: true }]

export type CampoPreenchido = { nome: string; valor: string }

export type TipoEncaminhamento = 'novo' | 'atualizacao' | 'cancelamento'
const TIPOS: TipoEncaminhamento[] = ['novo', 'atualizacao', 'cancelamento']

export type EncaminhamentoFeito = {
  tipo: TipoEncaminhamento
  // Na atualização e no cancelamento, o pedido inteiro como ficou
  campos: CampoPreenchido[]
  intencao: string | null
  resumo: string | null
  // Atualização: o que mudou, nas palavras da IA. Cancelamento: o motivo
  mudou: string | null
  createdAt: Date
}

export type NovoEncaminhamento = Omit<EncaminhamentoFeito, 'createdAt'>

// Campo que mudou numa atualização, em relação ao pedido anterior
export type Alteracao = { nome: string; antes: string | null; depois: string }

// O que a ferramenta registrou no turno, com as alterações (não gravadas: recalculadas
// a partir da lista quando preciso)
export type EncaminhamentoRegistrado = NovoEncaminhamento & { alteracoes: Alteracao[] }

// Onde cada porta guarda os encaminhamentos: WhatsApp por conversa, link de teste
// por sessão, bateria em memória.
export type PortaEncaminhamento = {
  // Os mais recentes da conversa, do mais antigo para o mais novo
  listar: () => Promise<EncaminhamentoFeito[]>
  registrar: (novo: NovoEncaminhamento) => Promise<void>
}

export type ResultadoPedido =
  | { tipo: 'registrado'; encaminhamento: EncaminhamentoRegistrado }
  | { tipo: 'faltando'; campos: string[] }
  | { tipo: 'limite' }
  | { tipo: 'sem_pedido' }
  | { tipo: 'sem_mudanca' }
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

function listaDeCampos(campos: CampoPedido[]): string {
  return campos.map((c) => `- ${c.nome}${c.obrigatorio ? ' (obrigatório)' : ' (opcional)'}`).join('\n')
}

function parametroCampos(campos: CampoPedido[], descricao: string): Record<string, unknown> {
  return {
    type: 'object',
    description: descricao,
    properties: Object.fromEntries(campos.map((c) => [c.nome, { type: 'string' }])),
    additionalProperties: { type: 'string' },
  }
}

export function definicoesFerramentas(campos: CampoPedido[]): DefinicaoFerramenta[] {
  const lista = listaDeCampos(campos)
  return [
    {
      nome: NOME_FERRAMENTA,
      descricao: `Registra um pedido NOVO da pessoa e encaminha para a equipe do negócio. Chame quando a conversa chegar no ponto de encaminhar. Responde "registrado", "faltando: X" (peça X à pessoa) ou "limite atingido" (não prometa retorno). Se já existe um pedido ativo e a pessoa só mudou algo nele, use ${FERRAMENTA_ATUALIZAR}.
Campos do pedido, use exatamente estes nomes como chaves em "campos":
${lista}
Preencha só o que a pessoa disse ou confirmou; não invente. Data só vale se for um dia específico: data vaga ("semana que vem", "qualquer dia") fica vazia. Tudo em português.`,
      parametros: {
        type: 'object',
        properties: {
          campos: parametroCampos(campos, 'Valores dos campos do pedido, com os nomes da lista como chaves'),
          intencao: { type: 'string', description: 'Em uma linha, o que a pessoa quer' },
          resumo: {
            type: 'string',
            description: '2 a 3 linhas de contexto útil para a equipe agir, sem floreio',
          },
        },
        required: ['campos', 'intencao', 'resumo'],
      },
    },
    {
      nome: FERRAMENTA_ATUALIZAR,
      descricao: `Atualiza o pedido ativo desta conversa (o último registrado e não cancelado) e avisa a equipe. Chame só quando a pessoa MUDAR um dado de um pedido já registrado (ex.: outro horário, mais pessoas) ou acrescentar algo a ele. Conversa sobre o pedido, sem mudança, não é atualização. Responde "atualizado", "sem pedido ativo" (não há o que atualizar), "nada mudou" ou "limite atingido".
Em "campos", mande só os campos que mudaram, com os mesmos nomes do pedido:
${lista}
Tudo em português.`,
      parametros: {
        type: 'object',
        properties: {
          campos: parametroCampos(campos, 'Só os campos que mudaram, com o valor novo'),
          o_que_mudou: {
            type: 'string',
            description: 'Em uma linha, o que mudou (ex.: "horário passou de 19h para 20h")',
          },
          resumo: {
            type: 'string',
            description: '2 a 3 linhas de contexto do pedido como ficou, para a equipe agir',
          },
        },
        required: ['campos', 'o_que_mudou', 'resumo'],
      },
    },
    {
      nome: FERRAMENTA_CANCELAR,
      descricao: `Cancela o pedido ativo desta conversa e avisa a equipe. Chame só quando a pessoa disser claramente que desistiu ou quer cancelar o pedido. Responde "cancelado", "sem pedido ativo" ou "limite atingido". Tudo em português.`,
      parametros: {
        type: 'object',
        properties: {
          motivo: {
            type: 'string',
            description: 'Em uma linha, o motivo que a pessoa deu; "não informado" se ela não disse',
          },
        },
        required: ['motivo'],
      },
    },
  ]
}

function texto(valor: unknown): string {
  if (typeof valor === 'string') return valor.trim()
  if (typeof valor === 'number') return String(valor)
  return ''
}

// Valores vazios ou que só dizem que não sabe contam como faltando
const VAZIO = /^(-|n\/?a|null|nenhum|nenhuma|não informado|nao informado|não sei|nao sei|\?+)$/i

function vazio(valor: string): boolean {
  return valor === '' || VAZIO.test(valor)
}

function comoObjeto(valor: unknown): Record<string, unknown> | null {
  return valor && typeof valor === 'object' && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : null
}

// Valores mandados pela IA, por nome em minúsculas: a IA pode variar maiúsculas,
// o nome do cadastro é o que vale
function camposRecebidos(p: Record<string, unknown>): Map<string, string> {
  const recebidos = comoObjeto(p.campos) ?? {}
  return new Map(Object.entries(recebidos).map(([k, v]) => [k.trim().toLowerCase(), texto(v)]))
}

// Confere o pedido sem gravar. `feitosHoje` = encaminhamentos novos da conversa desde a meia-noite.
export function conferirPedido(args: {
  campos: CampoPedido[]
  pedido: unknown
  feitosHoje: number
}): ResultadoPedido {
  const { campos, feitosHoje } = args
  const p = comoObjeto(args.pedido)
  if (!p) return { tipo: 'invalido' }
  const porNome = camposRecebidos(p)

  const preenchidos: CampoPreenchido[] = []
  const faltando: string[] = []
  for (const c of campos) {
    const valor = porNome.get(c.nome.toLowerCase()) ?? ''
    if (vazio(valor) && c.obrigatorio) faltando.push(c.nome)
    if (!vazio(valor)) preenchidos.push({ nome: c.nome, valor: valor.slice(0, 300) })
  }
  if (faltando.length > 0) return { tipo: 'faltando', campos: faltando }
  if (feitosHoje >= LIMITE_DIARIO) return { tipo: 'limite' }

  return {
    tipo: 'registrado',
    encaminhamento: {
      tipo: 'novo',
      campos: preenchidos,
      intencao: texto(p.intencao).slice(0, 300) || null,
      resumo: texto(p.resumo).slice(0, 1000) || null,
      mudou: null,
      alteracoes: [],
    },
  }
}

// O pedido ativo: o último novo ou atualização que não foi cancelado depois
export function pedidoAtivo(feitos: EncaminhamentoFeito[]): EncaminhamentoFeito | null {
  let ativo: EncaminhamentoFeito | null = null
  for (const f of feitos) ativo = f.tipo === 'cancelamento' ? null : f
  return ativo
}

export function compararCampos(antes: CampoPreenchido[], depois: CampoPreenchido[]): Alteracao[] {
  const anteriores = new Map(antes.map((c) => [c.nome.toLowerCase(), c.valor]))
  return depois
    .filter((c) => anteriores.get(c.nome.toLowerCase()) !== c.valor)
    .map((c) => ({ nome: c.nome, antes: anteriores.get(c.nome.toLowerCase()) ?? null, depois: c.valor }))
}

// Cada encaminhamento com as alterações em relação ao pedido ativo anterior (para
// remontar o card do link de teste a partir do que está gravado)
export function comAlteracoes(feitos: EncaminhamentoFeito[]): (EncaminhamentoFeito & { alteracoes: Alteracao[] })[] {
  let ativo: CampoPreenchido[] | null = null
  return feitos.map((f) => {
    const alteracoes = f.tipo === 'atualizacao' && ativo ? compararCampos(ativo, f.campos) : []
    ativo = f.tipo === 'cancelamento' ? null : f.campos
    return { ...f, alteracoes }
  })
}

// Confere a atualização sem gravar. Os campos mandados entram por cima do pedido
// ativo; o registro guarda o pedido inteiro como ficou. `mudancasHoje` = atualizações
// e cancelamentos da conversa desde a meia-noite.
export function conferirAtualizacao(args: {
  campos: CampoPedido[]
  pedido: unknown
  ativo: EncaminhamentoFeito | null
  mudancasHoje: number
}): ResultadoPedido {
  const { campos, ativo, mudancasHoje } = args
  const p = comoObjeto(args.pedido)
  if (!p) return { tipo: 'invalido' }
  if (!ativo) return { tipo: 'sem_pedido' }

  const porNome = camposRecebidos(p)
  const anteriores = new Map(ativo.campos.map((c) => [c.nome.toLowerCase(), c.valor]))
  const mesclados: CampoPreenchido[] = []
  for (const c of campos) {
    const novo = porNome.get(c.nome.toLowerCase()) ?? ''
    const valor = vazio(novo) ? (anteriores.get(c.nome.toLowerCase()) ?? '') : novo.slice(0, 300)
    if (valor) mesclados.push({ nome: c.nome, valor })
  }
  // Campo do pedido que saiu do cadastro depois do registro continua no pedido
  const doCadastro = new Set(campos.map((c) => c.nome.toLowerCase()))
  for (const c of ativo.campos) if (!doCadastro.has(c.nome.toLowerCase())) mesclados.push(c)

  const alteracoes = compararCampos(ativo.campos, mesclados)
  const mudou = texto(p.o_que_mudou).slice(0, 300) || null
  if (alteracoes.length === 0 && !mudou) return { tipo: 'sem_mudanca' }
  if (mudancasHoje >= LIMITE_DIARIO_MUDANCAS) return { tipo: 'limite' }

  return {
    tipo: 'registrado',
    encaminhamento: {
      tipo: 'atualizacao',
      campos: mesclados,
      intencao: ativo.intencao,
      resumo: texto(p.resumo).slice(0, 1000) || ativo.resumo,
      mudou,
      alteracoes,
    },
  }
}

// Confere o cancelamento sem gravar. O registro leva o pedido cancelado e o motivo.
export function conferirCancelamento(args: {
  pedido: unknown
  ativo: EncaminhamentoFeito | null
  mudancasHoje: number
}): ResultadoPedido {
  const { ativo, mudancasHoje } = args
  const p = comoObjeto(args.pedido)
  if (!p) return { tipo: 'invalido' }
  if (!ativo) return { tipo: 'sem_pedido' }
  if (mudancasHoje >= LIMITE_DIARIO_MUDANCAS) return { tipo: 'limite' }

  const motivo = texto(p.motivo).slice(0, 300)
  return {
    tipo: 'registrado',
    encaminhamento: {
      tipo: 'cancelamento',
      campos: ativo.campos,
      intencao: ativo.intencao,
      resumo: ativo.resumo,
      mudou: motivo && !vazio(motivo) ? motivo : null,
      alteracoes: [],
    },
  }
}

const REGISTRADO: Record<TipoEncaminhamento, string> = {
  novo: 'registrado',
  atualizacao: 'atualizado',
  cancelamento: 'cancelado',
}

export function textoDoResultado(r: ResultadoPedido): string {
  switch (r.tipo) {
    case 'registrado':
      return REGISTRADO[r.encaminhamento.tipo]
    case 'faltando':
      return `faltando: ${r.campos.join(', ')}`
    case 'limite':
      return 'limite atingido'
    case 'sem_pedido':
      return `sem pedido ativo: não há pedido registrado nesta conversa para mudar. Se for um pedido novo, use ${NOME_FERRAMENTA}.`
    case 'sem_mudanca':
      return 'nada mudou: mande em "campos" o valor novo do que mudou, ou descreva em "o_que_mudou"'
    default:
      return 'erro: chame de novo com os parâmetros pedidos'
  }
}

// Conta os encaminhamentos desde `desde`: os novos (limite de 3) ou as mudanças (teto de 5)
export function contarDesde(feitos: EncaminhamentoFeito[], desde: Date, quais: 'novos' | 'mudancas'): number {
  return feitos.filter(
    (f) => f.createdAt.getTime() >= desde.getTime() && (f.tipo === 'novo') === (quais === 'novos'),
  ).length
}

const ROTULO_TIPO: Record<TipoEncaminhamento, string> = {
  novo: 'novo',
  atualizacao: 'atualização',
  cancelamento: 'cancelamento',
}

function textoCampos(campos: CampoPreenchido[]): string {
  return campos.map((c) => `${c.nome}: ${c.valor}`).join('; ') || '(sem campos)'
}

// Estado do encaminhamento para os dados do momento: o que já foi feito na
// conversa, o pedido ativo e as contagens do dia, com aviso quando um limite foi atingido.
export function blocoEstado(feitos: EncaminhamentoFeito[], agora: Date): string {
  const inicio = inicioDoDiaBrasilia(agora)
  const novosHoje = contarDesde(feitos, inicio, 'novos')
  const mudancasHoje = contarDesde(feitos, inicio, 'mudancas')
  if (feitos.length === 0) {
    return `<estado_encaminhamento>
# ENCAMINHAMENTOS DESTA CONVERSA
Nenhum encaminhamento registrado nesta conversa ainda.
Novos hoje: ${novosHoje} de ${LIMITE_DIARIO}.
</estado_encaminhamento>`
  }

  const linhas = feitos.map((f) => {
    const quando = formatarDataHoraBrasilia(f.createdAt)
    if (f.tipo === 'cancelamento') return `- ${quando} · cancelamento${f.mudou ? ` (motivo: ${f.mudou})` : ''}`
    const detalhe = f.tipo === 'atualizacao' ? (f.mudou ? ` (mudou: ${f.mudou})` : '') : f.intencao ? ` (${f.intencao})` : ''
    return `- ${quando} · ${ROTULO_TIPO[f.tipo]}: ${textoCampos(f.campos)}${detalhe}`
  })
  const ativo = pedidoAtivo(feitos)
  const avisos: string[] = []
  if (novosHoje >= LIMITE_DIARIO) {
    avisos.push(
      `LIMITE ATINGIDO: hoje já foram ${novosHoje} encaminhamentos novos nesta conversa. Não chame ${NOME_FERRAMENTA} de novo hoje; se a pessoa trouxer outro pedido, diga com leveza que amanhã consegue registrar.`,
    )
  }
  if (mudancasHoje >= LIMITE_DIARIO_MUDANCAS) {
    avisos.push(
      `LIMITE DE MUDANÇAS ATINGIDO: hoje já foram ${mudancasHoje} atualizações ou cancelamentos nesta conversa. Não chame ${FERRAMENTA_ATUALIZAR} nem ${FERRAMENTA_CANCELAR} de novo hoje; diga com leveza que amanhã consegue registrar a mudança.`,
    )
  }
  return `<estado_encaminhamento>
# ENCAMINHAMENTOS DESTA CONVERSA
Já registrados, do mais antigo para o mais novo (não registre de novo o mesmo pedido nem repita que vai encaminhar):
${linhas.join('\n')}
${ativo ? `Pedido ativo agora: ${textoCampos(ativo.campos)}. Se a pessoa mudar algo dele, use ${FERRAMENTA_ATUALIZAR}; se desistir, ${FERRAMENTA_CANCELAR}.` : 'Nenhum pedido ativo agora (o último foi cancelado). Um pedido novo vai por ' + NOME_FERRAMENTA + '.'}
Novos hoje: ${novosHoje} de ${LIMITE_DIARIO}. Atualizações e cancelamentos hoje: ${mudancasHoje} de ${LIMITE_DIARIO_MUDANCAS}.${avisos.map((a) => `\n${a}`).join('')}
</estado_encaminhamento>`
}

function lerCampos(valor: unknown): CampoPreenchido[] {
  return Array.isArray(valor)
    ? valor.filter((c): c is CampoPreenchido => !!c && typeof c === 'object' && typeof c.nome === 'string')
    : []
}

function paraFeito(r: {
  tipo: string
  campos: unknown
  intencao: string | null
  resumo: string | null
  mudou: string | null
  createdAt: Date
}): EncaminhamentoFeito {
  return {
    tipo: TIPOS.includes(r.tipo as TipoEncaminhamento) ? (r.tipo as TipoEncaminhamento) : 'novo',
    campos: lerCampos(r.campos),
    intencao: r.intencao,
    resumo: r.resumo,
    mudou: r.mudou,
    createdAt: r.createdAt,
  }
}

const SELECAO = { tipo: true, campos: true, intencao: true, resumo: true, mudou: true, createdAt: true } as const

// Só o que vai para o banco (as alterações são recalculadas quando preciso)
function dadosGravados(novo: NovoEncaminhamento) {
  return { tipo: novo.tipo, campos: novo.campos, intencao: novo.intencao, resumo: novo.resumo, mudou: novo.mudou }
}

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
      await prisma.encaminhamento.create({ data: { clienteId, conversaId, ...dadosGravados(novo) } })
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
      await prisma.encaminhamento.create({ data: { clienteId, sessaoId, ...dadosGravados(novo) } })
    },
  }
}

// Bateria: nada vai para o banco. O roteiro manda os encaminhamentos das rodadas anteriores.
export function portaMemoria(anteriores: EncaminhamentoFeito[]): PortaEncaminhamento {
  const lista = [...anteriores]
  return {
    listar: async () => [...lista],
    registrar: async (novo) => {
      lista.push({ ...dadosGravados(novo), createdAt: new Date() })
    },
  }
}

// Nome do contato, para o e-mail e o card: o campo "nome" do pedido, se houver
export function nomeDoPedido(campos: CampoPreenchido[]): string | null {
  return campos.find((c) => /^nome\b/i.test(c.nome))?.valor ?? null
}
