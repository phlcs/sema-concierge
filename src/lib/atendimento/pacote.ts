import { remetentePadrao } from '@/lib/admin/cadastro'
import {
  nomeDoPedido,
  type Alteracao,
  type CampoPreenchido,
  type EncaminhamentoRegistrado,
  type TipoEncaminhamento,
} from './encaminhamento'

// Pacote do encaminhamento (T10): o que vai para a equipe, independente do destino.
// O e-mail e o card do link de teste são montados a partir dele, com os mesmos
// rótulos e textos. Sempre em português, qualquer que seja o idioma da conversa.

export type PacoteEncaminhamento = {
  tipo: TipoEncaminhamento
  nomeNegocio: string
  // Campo "nome" do pedido, quando houver
  nomeContato: string | null
  // Telefone do WhatsApp (ou o contato fixo do link de teste)
  contato: string
  // Na ordem do cadastro; na atualização e no cancelamento, o pedido inteiro como ficou
  campos: CampoPreenchido[]
  resumo: string | null
  // Atualização: o que mudou, nas palavras da IA. Cancelamento: o motivo
  mudou: string | null
  alteracoes: Alteracao[]
  quando: Date
}

export function montarPacote(args: {
  nomeNegocio: string
  contato: string
  encaminhamento: EncaminhamentoRegistrado
  quando: Date
}): PacoteEncaminhamento {
  const { encaminhamento: e } = args
  return {
    tipo: e.tipo,
    nomeNegocio: args.nomeNegocio,
    nomeContato: nomeDoPedido(e.campos),
    contato: args.contato,
    campos: e.campos,
    resumo: e.resumo,
    mudou: e.mudou,
    alteracoes: e.alteracoes,
    quando: args.quando,
  }
}

export const TITULO_ENCAMINHAMENTO: Record<TipoEncaminhamento, string> = {
  novo: 'Novo encaminhamento',
  atualizacao: 'Atualização de encaminhamento',
  cancelamento: 'Cancelamento de encaminhamento',
}

export function formatarQuando(quando: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(quando)
}

function umaLinha(valor: string, max: number): string {
  const limpo = valor.replace(/\s+/g, ' ').trim()
  return limpo.length > max ? `${limpo.slice(0, max - 1).trimEnd()}…` : limpo
}

function juntar(itens: string[]): string {
  if (itens.length <= 1) return itens.join('')
  return `${itens.slice(0, -1).join(', ')} e ${itens.at(-1)}`
}

// Assunto: tipo + nome (só o nome; campo do pedido pode ser longo). Na atualização,
// os nomes dos campos que mudaram. Ex.: "Atualização de encaminhamento: Marcos, mudou horário"
export function assuntoEncaminhamento(p: PacoteEncaminhamento): string {
  const quem = umaLinha(p.nomeContato ?? `contato ${p.contato}`, 60)
  const mudou =
    p.tipo === 'atualizacao' && p.alteracoes.length > 0
      ? `, mudou ${umaLinha(juntar(p.alteracoes.map((a) => a.nome.toLowerCase())), 60)}`
      : ''
  return `${TITULO_ENCAMINHAMENTO[p.tipo]}: ${quem}${mudou}`
}

export type LinhaEncaminhamento = { rotulo: string; valor: string }

export type CorpoEncaminhamento = {
  titulo: string
  // Bloco em destaque no topo: o que mudou (atualização) ou o motivo (cancelamento)
  destaque: { rotulo: string; itens: string[] } | null
  // Campos na ordem do cadastro, contato, resumo e quando
  linhas: LinhaEncaminhamento[]
}

export function corpoEncaminhamento(p: PacoteEncaminhamento): CorpoEncaminhamento {
  let destaque: CorpoEncaminhamento['destaque'] = null
  if (p.tipo === 'atualizacao') {
    const itens = p.alteracoes.map((a) => (a.antes ? `${a.nome}: ${a.antes} → ${a.depois}` : `${a.nome}: ${a.depois}`))
    destaque = { rotulo: 'O que mudou', itens: p.mudou ? [p.mudou, ...itens] : itens }
  } else if (p.tipo === 'cancelamento') {
    destaque = { rotulo: 'Pedido cancelado', itens: [`Motivo: ${p.mudou ?? 'não informado'}`] }
  }
  return {
    titulo: TITULO_ENCAMINHAMENTO[p.tipo],
    destaque,
    linhas: [
      ...p.campos.map((c) => ({ rotulo: c.nome, valor: c.valor })),
      { rotulo: 'Contato', valor: p.contato },
      { rotulo: 'Resumo', valor: p.resumo ?? 'não informado' },
      { rotulo: 'Quando', valor: formatarQuando(p.quando) },
    ],
  }
}

// Nome que aparece como remetente do e-mail: o do cadastro ou "Concierge <negócio>".
// Sem caracteres que quebram o cabeçalho "Nome <email>".
export function nomeRemetente(cliente: { nomeRemetente: string | null; nomeNegocio: string }): string {
  const nome = cliente.nomeRemetente?.trim() || remetentePadrao(cliente.nomeNegocio)
  return nome.replace(/[<>"\r\n]/g, '').trim().slice(0, 120) || 'Concierge'
}
