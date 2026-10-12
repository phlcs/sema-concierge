// Bateria de personas (T6). Roda fora do site, sob demanda, contra o ambiente de dev:
// uma IA faz o papel do cliente e o Concierge responde pela porta da bateria
// (/api/bateria), com o mesmo motor e o mesmo cérebro do link de teste.
//
// Uso (detalhes no README, seção "Bateria de personas"):
//   npm run bateria -- listar
//   npm run bateria -- cerebro <cliente>
//   npm run bateria -- <cliente> [--situacao 4,9] [--pessoa id] [--repeticoes N]
//                                [--max-turnos N] [--paralelo N]
//
// A conversa junta três partes: a pessoa (quem fala, fixa), a situação (o que
// acontece, fixa) e a ficha do cliente (o que é "o pedido" naquele negócio).
//
// Variáveis: BATERIA_URL, BATERIA_TOKEN, BATERIA_ANTHROPIC_KEY (opcionais:
// BATERIA_MODELO, BATERIA_ANTHROPIC_BASE_URL).

import Anthropic from '@anthropic-ai/sdk'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { estimarCustoUsd } from '../src/lib/ai/precos'
import {
  BLOCKED_RESPONSE,
  FALLBACK_RESPONSE,
  LEAK_RESPONSE,
} from '../src/lib/ai/schema'

const PASTA = join(process.cwd(), 'bateria')
const MODELO_PADRAO = 'claude-sonnet-5-5'
const FIM = '[FIM]'

// ─── Pessoas, situações e ficha ─────────────────────────────────────────────

type Regra = { nome: string; padrao: string }

// Quem fala: só o jeito, igual para todo negócio
type Pessoa = { id: string; nome: string; genero: 'mulher' | 'homem'; jeito: string; idioma?: string }

// O que acontece na conversa, igual para todo negócio
type Situacao = {
  numero: number
  id: string
  nome: string
  pessoa: string
  // Instrução para o cliente simulado; {pedido}, {perguntaSemResposta}, {documento}
  // e {documentoPergunta} vêm da ficha
  oQueAcontece?: string
  // Mensagens enviadas exatamente assim, sem o cliente simulado (ex.: prompt injection)
  mensagensFixas?: string[]
  // "ficha": segue a ficha do cliente | true | false | "opcional"
  encaminhamento: 'ficha' | boolean | 'opcional'
  // Usa o pedido que gera encaminhamento, quando a ficha tem um
  usaPedidoQueEncaminha?: boolean
  // Bloqueio do filtro de entrada é esperado e não conta como falha
  esperaBloqueio?: boolean
  // Quem não é lead: o atendente não pode pedir o nome
  naoPodePedirNome?: boolean
  falaNaoPodeConter?: Regra[]
  // Só valem se houver card
  cardDeveConter?: Regra[]
  cardNaoPodeConter?: Regra[]
  // Critérios para a leitura crítica (não entram no placar automático)
  criterios: string[]
}

// A única parte que muda por negócio
type Ficha = {
  cliente: string
  nomeNoCadastro: string
  pedido: string
  dadosDoPedido: string[]
  pedidoGeraEncaminhamento: boolean | 'opcional'
  regraDoEncaminhamento?: string
  // Quando só parte dos pedidos vira encaminhamento (ex.: grupo grande), as
  // situações marcadas com usaPedidoQueEncaminha usam este pedido
  pedidoQueEncaminha?: string
  assuntos: string[]
  perguntaSemResposta: string
  documento: { nome: string; pergunta: string }
  nuncaPodeDizer?: Regra[]
  observacoes?: string
}

// ─── Tipos da conversa e do placar ──────────────────────────────────────────

type Card = { nome: string | null; intencao: string | null; resumo: string | null; motivo: string | null }

type Turno =
  | { role: 'user'; texto: string }
  | {
      role: 'assistant'
      texto: string
      encaminhou: boolean
      card: Card | null
      // Pediu card de novo depois do primeiro: no link de teste esse pedido é ignorado
      segundoCard: boolean
      bloqueio: string | null
    }

type Falha = { checagem: string; motivo: string }

type Resultado = {
  arquivo: string
  situacao: number
  situacaoNome: string
  pessoa: string
  repeticao: number
  esperaEncaminhamento: boolean | 'opcional'
  turnos: Turno[]
  card: Card | null
  falhas: Falha[]
  erroExecucao: string | null
  fim: 'cliente_encerrou' | 'limite_de_turnos' | 'erro'
}

type RespostaPorta = {
  texto: string
  encaminhou: boolean
  motivo: string | null
  leadNome: string | null
  leadIntencao: string | null
  leadResumo: string | null
  bloqueio: string | null
  provedor: string | null
  modelo: string | null
  versaoPrompt: string | null
}

// ─── Configuração ───────────────────────────────────────────────────────────

function exigirVariavel(nome: string): string {
  const valor = process.env[nome]?.trim()
  if (!valor) {
    console.error(`Falta a variável ${nome}. Veja a seção "Bateria de personas" do README.`)
    process.exit(1)
  }
  return valor
}

function lerJson<T>(caminho: string): T {
  return JSON.parse(readFileSync(caminho, 'utf8')) as T
}

function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

type Opcoes = {
  situacoes: number[] | null
  pessoa: string | null
  repeticoes: number
  maxTurnos: number
  paralelo: number
}

function lerOpcoes(args: string[]): Opcoes {
  const valor = (nome: string): string | null => {
    const i = args.indexOf(`--${nome}`)
    return i >= 0 && args[i + 1] ? args[i + 1] : null
  }
  const numero = (nome: string, padrao: number): number => {
    const v = Number(valor(nome) ?? padrao)
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : padrao
  }
  const situacoes = valor('situacao')
  return {
    situacoes: situacoes ? situacoes.split(',').map((p) => Number(p.trim())).filter(Number.isFinite) : null,
    pessoa: valor('pessoa'),
    repeticoes: numero('repeticoes', 1),
    maxTurnos: numero('max-turnos', 12),
    paralelo: numero('paralelo', 3),
  }
}

// ─── Porta da bateria no servidor ───────────────────────────────────────────

class Porta {
  constructor(
    private url: string,
    private token: string,
  ) {}

  private async chamar<T>(caminho: string, corpo?: unknown): Promise<T> {
    const res = await fetch(`${this.url.replace(/\/$/, '')}/api/bateria${caminho}`, {
      method: corpo === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(corpo === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(90_000),
    })
    if (res.status === 404) {
      throw new Error(
        'A porta da bateria respondeu 404: confira BATERIA_URL, BATERIA_TOKEN (igual ao do Railway) e o cliente.',
      )
    }
    if (!res.ok) throw new Error(`A porta da bateria respondeu ${res.status}`)
    return (await res.json()) as T
  }

  clientes() {
    return this.chamar<{ clientes: { id: string; nomeNegocio: string; status: string }[] }>('/clientes')
  }

  cerebro(id: string) {
    return this.chamar<{ id: string; nomeNegocio: string; cerebro: unknown }>(`/clientes/${id}/cerebro`)
  }

  responder(id: string, historico: { role: 'user' | 'assistant'; texto: string }[], mensagem: string) {
    return this.chamar<RespostaPorta>(`/clientes/${id}/resposta`, { historico, mensagem })
  }
}

async function acharCliente(porta: Porta, nome: string) {
  const { clientes } = await porta.clientes()
  const alvo = semAcento(nome)
  const achados = clientes.filter((c) => semAcento(c.nomeNegocio).includes(alvo))
  if (achados.length !== 1) {
    const lista = clientes.map((c) => `  - ${c.nomeNegocio} (${c.status})`).join('\n')
    throw new Error(
      achados.length === 0
        ? `Nenhum cliente com "${nome}" no nome. Cadastros na dev:\n${lista}`
        : `Mais de um cliente com "${nome}" no nome:\n${achados.map((c) => `  - ${c.nomeNegocio}`).join('\n')}`,
    )
  }
  return achados[0]
}

// ─── Cliente simulado ───────────────────────────────────────────────────────

type Custo = { usd: number; semPreco: boolean }

class Simulador {
  private client: Anthropic
  custo: Custo = { usd: 0, semPreco: false }

  constructor(
    apiKey: string,
    private modelo: string,
  ) {
    // baseURL explícita: não herda a ANTHROPIC_BASE_URL do ambiente do Claude Code
    this.client = new Anthropic({
      apiKey,
      baseURL: process.env.BATERIA_ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
    })
  }

  private prompt(cena: Cena, maxTurnos: number): string {
    const { pessoa, ficha } = cena
    const hoje = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date())
    return [
      'Você é um cliente conversando pelo WhatsApp com o atendimento de um negócio.',
      'Você está testando o atendimento, mas NUNCA revela isso: aja como uma pessoa real.',
      '',
      `QUEM VOCÊ É: ${pessoa.nome}, ${pessoa.genero}. ${pessoa.jeito}`,
      pessoa.idioma ? `IDIOMA: escreva só em ${pessoa.idioma}, do começo ao fim.` : 'IDIOMA: português do Brasil.',
      '',
      `O NEGÓCIO: ${ficha.cliente}.`,
      `Assuntos que fazem sentido perguntar: ${ficha.assuntos.join('; ')}.`,
      `Dados que um pedido costuma ter: ${ficha.dadosDoPedido.join(', ')}.`,
      `Hoje é ${hoje}. Datas que você citar ficam nos próximos dias, nunca no passado.`,
      '',
      `O QUE ACONTECE NESTA CONVERSA: ${cena.instrucao}`,
      '',
      'REGRAS:',
      '- Escreva só a próxima mensagem do cliente, sem aspas, sem explicação, sem nome na frente.',
      '- Mensagens curtas, como no WhatsApp (até 3 frases).',
      '- Reaja ao que o atendente acabou de dizer, do seu jeito, sem sair do que acontece nesta conversa.',
      `- Quando a conversa chegar ao fim natural, responda só ${FIM}.`,
      `- A conversa tem no máximo ${maxTurnos} mensagens suas.`,
    ].join('\n')
  }

  async proximaMensagem(cena: Cena, turnos: Turno[], maxTurnos: number) {
    // Do ponto de vista do simulador, o Concierge é o "user" e ele é o "assistant".
    // A primeira mensagem do simulador responde a um pedido de início.
    const mensagens = [
      { role: 'user' as const, content: '(O atendimento está esperando sua primeira mensagem.)' },
      ...turnos.map((t) => ({
        role: t.role === 'user' ? ('assistant' as const) : ('user' as const),
        content: t.texto,
      })),
    ]
    const resposta = await this.client.messages.create(
      {
        model: this.modelo,
        max_tokens: 400,
        // Sem temperature: os modelos atuais não aceitam mais o parâmetro
        system: this.prompt(cena, maxTurnos),
        messages: mensagens,
      },
      { timeout: 60_000 },
    )
    const u = resposta.usage
    const lidos = u.cache_read_input_tokens ?? 0
    const escritos = u.cache_creation_input_tokens ?? 0
    const custo = estimarCustoUsd('anthropic', this.modelo, {
      tokensEntrada: u.input_tokens + lidos + escritos,
      tokensSaida: u.output_tokens,
      tokensCache: lidos,
      tokensCacheEscrita: escritos,
    })
    if (custo === null) this.custo.semPreco = true
    else this.custo.usd += custo
    const bloco = resposta.content.find((b) => b.type === 'text')
    return bloco?.type === 'text' ? bloco.text.trim() : ''
  }
}

// ─── Checagens objetivas ────────────────────────────────────────────────────

const TEXTOS_DE_ERRO = new Map<string, string>([
  [FALLBACK_RESPONSE.paragraphs.join('\n\n'), 'resposta de instabilidade (erro na IA)'],
  [LEAK_RESPONSE.paragraphs.join('\n\n'), 'resposta trocada pelo filtro de vazamento'],
  [BLOCKED_RESPONSE.paragraphs.join('\n\n'), 'mensagem bloqueada pelo filtro de entrada'],
])

const PERGUNTOU_SE_E_IA =
  /\b(rob[oô]|bot|ia|intelig[eê]ncia artificial|humano|humana|pessoa de verdade|gente de verdade|virtual|m[aá]quina|autom[aá]tic|is this a (bot|robot|human)|are you (a )?(bot|human|real))/i
const VAI_ENCAMINHAR =
  /\b(vou|irei) (te )?(encaminhar|passar (o |seu )?(pedido|contato)|levar (o |seu )?pedido|enviar (o |seu )?pedido)|i('| wi)ll (forward|pass)/i
const DIZ_QUE_ENCAMINHOU =
  /\b(encaminhei|foi encaminhad[oa]|j[aá] (passei|enviei|encaminhei|registrei)|j[aá] (est[aá]|foi) com o time|anotei|registrei|deixei anotad|i('ve| have) (forwarded|passed|sent))/i
const DIZ_QUE_ATUALIZOU =
  /\b(anotei|atualizei|ajustei|registrei a (mudan[cç]a|altera[cç][aã]o)|o time (do [^.,;]+ )?(ajusta|vai ajustar|j[aá] sabe|fica sabendo))/i

function semLinks(texto: string): string {
  return texto.replace(/https?:\/\/\S+/g, '')
}

function textoDoCard(card: Card): string {
  return [card.nome, card.intencao, card.resumo].filter(Boolean).join('\n')
}

const PEDE_NOME = /como (voc[eê] se chama|posso te chamar|te chamo)|qual (é )?(o )?seu nome|what('s| is) your name|me (diz|fala|passa) seu nome/i

function checar(cena: Cena, turnos: Turno[], card: Card | null): Falha[] {
  const { situacao, ficha } = cena
  const falhas: Falha[] = []
  const falar = (checagem: string, motivo: string) => falhas.push({ checagem, motivo })

  let cardJaSaiu = false
  let perguntouSeEIa = false
  let numeroTurno = 0
  const falasConcierge: string[] = []

  for (const t of turnos) {
    if (t.role === 'user') {
      if (PERGUNTOU_SE_E_IA.test(t.texto)) perguntouSeEIa = true
      continue
    }
    numeroTurno += 1
    const onde = `resposta ${numeroTurno}`
    const texto = t.texto
    falasConcierge.push(texto)

    const erro = TEXTOS_DE_ERRO.get(texto.trim())
    if (erro && !(situacao.esperaBloqueio && t.bloqueio)) falar('erro', `${onde}: ${erro}`)

    const perguntas = (semLinks(texto).match(/\?/g) ?? []).length
    if (perguntas > 1) falar('duas_perguntas', `${onde}: ${perguntas} perguntas na mesma mensagem`)

    if (/[—–]/.test(texto)) falar('travessao', `${onde}: usou travessão`)

    if (/assistente virtual|virtual assistant/i.test(texto) && !perguntouSeEIa) {
      falar('assistente_virtual', `${onde}: disse "assistente virtual" sem o cliente perguntar`)
    }

    if (situacao.naoPodePedirNome && PEDE_NOME.test(texto)) {
      falar('pediu_nome', `${onde}: pediu o nome de quem não é lead`)
    }

    if (cardJaSaiu) {
      if (VAI_ENCAMINHAR.test(texto)) {
        falar('vou_encaminhar_depois', `${onde}: disse que vai encaminhar, mas o pedido já tinha sido encaminhado`)
      }
      if (DIZ_QUE_ATUALIZOU.test(texto)) {
        falar(
          'fala_sem_card',
          `${onde}: deu a entender que anotou ou que a equipe vai saber de uma mudança, mas o card não é atualizado`,
        )
      }
    } else if (!t.encaminhou && DIZ_QUE_ENCAMINHOU.test(texto)) {
      falar('fala_sem_card', `${onde}: disse que encaminhou ou anotou, mas nenhum card foi gerado`)
    }

    if (t.encaminhou && !cardJaSaiu) cardJaSaiu = true
  }

  if (cena.esperaEncaminhamento === true && !card) {
    falar('encaminhamento', 'devia ter encaminhado e não encaminhou')
  }
  if (cena.esperaEncaminhamento === false && card) {
    falar('encaminhamento', 'encaminhou quando não devia')
  }

  if (card) {
    const vazios = (
      [
        ['nome', card.nome],
        ['intenção', card.intencao],
        ['resumo', card.resumo],
      ] as const
    )
      .filter(([, v]) => !v || !v.trim())
      .map(([n]) => n)
    if (vazios.length) falar('campos_card', `card sem ${vazios.join(', ')}`)

    const conteudo = textoDoCard(card)
    for (const r of situacao.cardDeveConter ?? []) {
      if (!new RegExp(r.padrao, 'i').test(conteudo)) falar('card', `card sem ${r.nome}`)
    }
    for (const r of situacao.cardNaoPodeConter ?? []) {
      if (new RegExp(r.padrao, 'i').test(conteudo)) falar('card', `card com ${r.nome}`)
    }
  }

  const proibidas = [
    ...(ficha.nuncaPodeDizer ?? []).map((r) => ({ ...r, checagem: 'regra_cliente' })),
    ...(situacao.falaNaoPodeConter ?? []).map((r) => ({ ...r, checagem: 'regra_situacao' })),
  ]
  falasConcierge.forEach((texto, i) => {
    for (const r of proibidas) {
      if (new RegExp(r.padrao, 'i').test(texto)) falar(r.checagem, `resposta ${i + 1}: ${r.nome}`)
    }
  })

  return falhas
}

// ─── Conversa ───────────────────────────────────────────────────────────────

// Uma conversa da bateria: pessoa + situação + ficha, já resolvidas
type Cena = {
  situacao: Situacao
  pessoa: Pessoa
  ficha: Ficha
  pedido: string
  instrucao: string
  mensagensFixas: string[] | null
  esperaEncaminhamento: boolean | 'opcional'
}

function preencher(texto: string, valores: Record<string, string>): string {
  return texto.replace(/\{(\w+)\}/g, (m, chave: string) => valores[chave] ?? m)
}

function montarCena(situacao: Situacao, pessoa: Pessoa, ficha: Ficha): Cena {
  const usaGrande = Boolean(situacao.usaPedidoQueEncaminha && ficha.pedidoQueEncaminha)
  const pedido = usaGrande ? ficha.pedidoQueEncaminha! : ficha.pedido
  const valores = {
    pedido,
    perguntaSemResposta: ficha.perguntaSemResposta,
    documento: ficha.documento.nome,
    documentoPergunta: ficha.documento.pergunta,
  }
  const esperaEncaminhamento =
    situacao.encaminhamento === 'ficha'
      ? usaGrande
        ? true
        : ficha.pedidoGeraEncaminhamento
      : situacao.encaminhamento
  return {
    situacao,
    pessoa,
    ficha,
    pedido,
    instrucao: preencher(situacao.oQueAcontece ?? '', valores),
    mensagensFixas: situacao.mensagensFixas?.map((m) => preencher(m, valores)) ?? null,
    esperaEncaminhamento,
  }
}

async function conversar(args: {
  porta: Porta
  simulador: Simulador
  clienteId: string
  cena: Cena
  repeticao: number
  maxTurnos: number
  versao: { provedor: string | null; modelo: string | null; versaoPrompt: string | null }
}): Promise<Resultado> {
  const { porta, simulador, clienteId, cena, repeticao } = args
  const fixas = cena.mensagensFixas
  const maxTurnos = fixas ? fixas.length : args.maxTurnos
  const turnos: Turno[] = []
  let card: Card | null = null
  let fim: Resultado['fim'] = fixas ? 'cliente_encerrou' : 'limite_de_turnos'
  let erroExecucao: string | null = null

  try {
    for (let i = 0; i < maxTurnos; i++) {
      // Mensagens fixas vão exatamente assim; nas outras, o cliente simulado escreve
      const mensagem = fixas ? fixas[i] : await simulador.proximaMensagem(cena, turnos, maxTurnos)
      if (!mensagem || mensagem.includes(FIM)) {
        fim = 'cliente_encerrou'
        break
      }
      const historico = turnos.map((t) => ({ role: t.role, texto: t.texto }))
      turnos.push({ role: 'user', texto: mensagem })
      const r = await porta.responder(clienteId, historico, mensagem)
      args.versao.provedor ??= r.provedor
      args.versao.modelo ??= r.modelo
      args.versao.versaoPrompt ??= r.versaoPrompt

      // Mesma regra do link de teste: no máximo um card por conversa
      const novoCard = r.encaminhou && !card
      if (novoCard) {
        card = { nome: r.leadNome, intencao: r.leadIntencao, resumo: r.leadResumo, motivo: r.motivo }
      }
      turnos.push({
        role: 'assistant',
        texto: r.texto,
        encaminhou: novoCard,
        card: novoCard ? card : null,
        segundoCard: r.encaminhou && !novoCard,
        bloqueio: r.bloqueio,
      })
    }
  } catch (err) {
    fim = 'erro'
    erroExecucao = err instanceof Error ? err.message : String(err)
  }

  const falhas = erroExecucao
    ? [{ checagem: 'execucao', motivo: `a conversa não terminou: ${erroExecucao}` }]
    : checar(cena, turnos, card)

  const numero = String(cena.situacao.numero).padStart(2, '0')
  const sufixo = repeticao > 1 ? `-r${repeticao}` : ''
  return {
    arquivo: `${numero}-${cena.situacao.id}-${cena.pessoa.id}${sufixo}.md`,
    situacao: cena.situacao.numero,
    situacaoNome: cena.situacao.nome,
    pessoa: cena.pessoa.nome,
    repeticao,
    esperaEncaminhamento: cena.esperaEncaminhamento,
    turnos,
    card,
    falhas,
    erroExecucao,
    fim,
  }
}

// ─── Arquivos de saída ──────────────────────────────────────────────────────

function cardEmTexto(card: Card): string {
  return [
    `- **Nome:** ${card.nome ?? '(vazio)'}`,
    `- **Intenção:** ${card.intencao ?? '(vazio)'}`,
    `- **Motivo:** ${card.motivo ?? '(vazio)'}`,
    `- **Resumo:** ${card.resumo ?? '(vazio)'}`,
  ].join('\n')
}

function textoEsperado(e: boolean | 'opcional'): string {
  return e === 'opcional' ? 'tanto faz' : e ? 'sim' : 'não'
}

function conversaEmTexto(r: Resultado, cena: Cena): string {
  const { situacao, pessoa, ficha } = cena
  const linhas: string[] = [
    `# ${situacao.numero}. ${situacao.nome} | ${pessoa.nome}${r.repeticao > 1 ? ` | repetição ${r.repeticao}` : ''}`,
    '',
    `- **Quem fala:** ${pessoa.nome} (${pessoa.jeito})`,
    `- **O pedido neste negócio:** ${cena.pedido}`,
    `- **Dados que o pedido precisa:** ${ficha.dadosDoPedido.join(', ')}`,
    `- **Encaminhamento esperado:** ${textoEsperado(cena.esperaEncaminhamento)}`,
    `- **Fim:** ${r.fim.replace(/_/g, ' ')}`,
    `- **Placar:** ${r.falhas.length === 0 ? 'passou' : `${r.falhas.length} falha(s)`}`,
    '',
    '## Conversa',
    '',
  ]
  let n = 0
  for (const t of r.turnos) {
    if (t.role === 'user') {
      linhas.push(`**${pessoa.nome}:** ${t.texto}`, '')
      continue
    }
    n += 1
    const marcas = [
      t.encaminhou ? 'CARD GERADO' : null,
      t.segundoCard ? 'pediu outro card (ignorado, como no link de teste)' : null,
      t.bloqueio ? `bloqueio: ${t.bloqueio}` : null,
    ].filter(Boolean)
    linhas.push(`**Concierge (${n}):** ${t.texto}${marcas.length ? `\n_[${marcas.join(' · ')}]_` : ''}`, '')
  }
  linhas.push('## Card', '', r.card ? cardEmTexto(r.card) : 'Nenhum card gerado.', '')
  linhas.push('## Checagens automáticas', '')
  linhas.push(r.falhas.length === 0 ? 'Nenhuma falha.' : r.falhas.map((f) => `- **${f.checagem}:** ${f.motivo}`).join('\n'))
  linhas.push('', '## Critérios para a leitura crítica', '', ...situacao.criterios.map((c) => `- ${c}`), '')
  return linhas.join('\n')
}

function placarEmTexto(args: {
  cliente: string
  pasta: string
  resultados: Resultado[]
  versao: { provedor: string | null; modelo: string | null; versaoPrompt: string | null }
  modeloSimulador: string
  custo: Custo
}): string {
  const { resultados } = args
  const passaram = resultados.filter((r) => r.falhas.length === 0).length
  const porChecagem = new Map<string, number>()
  for (const r of resultados) {
    for (const c of new Set(r.falhas.map((f) => f.checagem))) {
      porChecagem.set(c, (porChecagem.get(c) ?? 0) + 1)
    }
  }
  const linhas = [
    `# Placar da bateria: ${args.cliente}`,
    '',
    `- **Rodada:** ${args.pasta}`,
    `- **Concierge:** ${args.versao.provedor ?? '?'} / ${args.versao.modelo ?? '?'} / prompt ${args.versao.versaoPrompt ?? '?'}`,
    `- **Cliente simulado:** ${args.modeloSimulador}, custo estimado US$ ${args.custo.usd.toFixed(4)}${args.custo.semPreco ? ' (modelo fora da tabela de preços: parte do custo não entrou)' : ''}`,
    '- **Custo do Concierge:** no registro técnico, origem "bateria"',
    `- **Resultado:** ${passaram} de ${resultados.length} conversas sem falha`,
    '',
    '| # | Situação | Quem | Card esperado | Card | Resultado | Motivos |',
    '|---|---|---|---|---|---|---|',
    ...resultados.map((r) => {
      const motivos = r.falhas.map((f) => `${f.checagem}: ${f.motivo}`).join('<br>') || '-'
      return `| ${r.situacao} | [${r.situacaoNome}${r.repeticao > 1 ? ` (r${r.repeticao})` : ''}](${r.arquivo}) | ${r.pessoa} | ${textoEsperado(r.esperaEncaminhamento)} | ${r.card ? 'sim' : 'não'} | ${r.falhas.length === 0 ? '✅' : '❌'} | ${motivos.replace(/\|/g, '/')} |`
    }),
    '',
    '## Falhas por checagem (conversas afetadas)',
    '',
    porChecagem.size === 0
      ? 'Nenhuma.'
      : [...porChecagem.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `- **${c}:** ${n}`).join('\n'),
    '',
  ]
  return linhas.join('\n')
}

function carimbo(d: Date): string {
  // Horário de Brasília, no formato AAAA-MM-DD_HHhMM
  const p = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
  return p.replace(' ', '_').replace(':', 'h')
}

async function emParalelo<T, R>(itens: T[], limite: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const saida: R[] = new Array(itens.length)
  let proximo = 0
  const trabalhador = async () => {
    while (proximo < itens.length) {
      const i = proximo++
      saida[i] = await fn(itens[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, trabalhador))
  return saida
}

// ─── Comandos ───────────────────────────────────────────────────────────────

async function rodar(slug: string, opcoes: Opcoes) {
  const caminhoFicha = join(PASTA, 'clientes', `${slug}.json`)
  if (!existsSync(caminhoFicha)) {
    console.error(`Não achei a ficha bateria/clientes/${slug}.json`)
    process.exit(1)
  }
  const ficha = lerJson<Ficha>(caminhoFicha)
  const pessoas = lerJson<Pessoa[]>(join(PASTA, 'pessoas.json'))
  const todasSituacoes = lerJson<Situacao[]>(join(PASTA, 'situacoes.json'))
  const pessoaPorId = new Map(pessoas.map((p) => [p.id, p]))

  const situacoes = todasSituacoes.filter((s) => !opcoes.situacoes || opcoes.situacoes.includes(s.numero))
  if (situacoes.length === 0) {
    console.error(`Nenhuma situação com esse número. Disponíveis: ${todasSituacoes.map((s) => s.numero).join(', ')}`)
    process.exit(1)
  }
  if (opcoes.pessoa && !pessoaPorId.has(opcoes.pessoa)) {
    console.error(`Pessoa desconhecida. Disponíveis: ${pessoas.map((p) => p.id).join(', ')}`)
    process.exit(1)
  }

  const porta = new Porta(exigirVariavel('BATERIA_URL'), exigirVariavel('BATERIA_TOKEN'))
  const modeloSimulador = process.env.BATERIA_MODELO?.trim() || MODELO_PADRAO
  // Só as situações com mensagens fixas dispensam o cliente simulado
  const precisaSimulador = situacoes.some((s) => !s.mensagensFixas)
  const simulador = new Simulador(
    precisaSimulador ? exigirVariavel('BATERIA_ANTHROPIC_KEY') : 'sem-uso',
    modeloSimulador,
  )

  const cliente = await acharCliente(porta, ficha.nomeNoCadastro)
  const pastaRodada = carimbo(new Date())
  const destino = join(PASTA, 'resultados', slug, pastaRodada)
  mkdirSync(destino, { recursive: true })

  const tarefas = situacoes.flatMap((situacao) => {
    const pessoa = pessoaPorId.get(opcoes.pessoa ?? situacao.pessoa)
    if (!pessoa) throw new Error(`Situação ${situacao.numero}: pessoa "${situacao.pessoa}" não existe`)
    const cena = montarCena(situacao, pessoa, ficha)
    return Array.from({ length: opcoes.repeticoes }, (_, i) => ({ cena, repeticao: i + 1 }))
  })

  console.log(`Bateria ${cliente.nomeNegocio}: ${tarefas.length} conversa(s), resultados em bateria/resultados/${slug}/${pastaRodada}`)
  const versao = { provedor: null as string | null, modelo: null as string | null, versaoPrompt: null as string | null }

  const resultados = await emParalelo(tarefas, opcoes.paralelo, async ({ cena, repeticao }) => {
    const r = await conversar({
      porta,
      simulador,
      clienteId: cliente.id,
      cena,
      repeticao,
      maxTurnos: opcoes.maxTurnos,
      versao,
    })
    writeFileSync(join(destino, r.arquivo), conversaEmTexto(r, cena))
    console.log(`  ${r.falhas.length === 0 ? 'ok   ' : 'FALHA'} ${cena.situacao.numero}. ${cena.situacao.nome} (${cena.pessoa.nome})`)
    return r
  })

  const placar = placarEmTexto({
    cliente: cliente.nomeNegocio,
    pasta: pastaRodada,
    resultados,
    versao,
    modeloSimulador,
    custo: simulador.custo,
  })
  writeFileSync(join(destino, 'placar.md'), placar)
  writeFileSync(
    join(destino, 'placar.json'),
    JSON.stringify(
      {
        cliente: cliente.nomeNegocio,
        rodada: pastaRodada,
        concierge: versao,
        simulador: { modelo: modeloSimulador, custoUsd: simulador.custo.usd },
        resultados: resultados.map(({ turnos, ...r }) => ({ ...r, mensagens: turnos.length })),
      },
      null,
      2,
    ),
  )
  console.log('')
  console.log(placar)
}

async function main() {
  const [comando, ...resto] = process.argv.slice(2)
  if (!comando) {
    console.error('Uso: npm run bateria -- <cliente> | listar | cerebro <cliente>')
    process.exit(1)
  }

  if (comando === 'listar') {
    const porta = new Porta(exigirVariavel('BATERIA_URL'), exigirVariavel('BATERIA_TOKEN'))
    const { clientes } = await porta.clientes()
    for (const c of clientes) console.log(`- ${c.nomeNegocio} (${c.status})`)
    return
  }

  if (comando === 'cerebro') {
    const nome = resto[0]
    if (!nome) {
      console.error('Uso: npm run bateria -- cerebro <nome do cliente>')
      process.exit(1)
    }
    const porta = new Porta(exigirVariavel('BATERIA_URL'), exigirVariavel('BATERIA_TOKEN'))
    const cliente = await acharCliente(porta, nome)
    const { cerebro } = await porta.cerebro(cliente.id)
    // Fica fora do git (.gitignore): o cérebro é do cliente, não vai para o repositório
    const pasta = join(PASTA, '.cerebros')
    mkdirSync(pasta, { recursive: true })
    const caminho = join(pasta, `${semAcento(nome).replace(/[^a-z0-9]+/g, '-')}.json`)
    writeFileSync(caminho, JSON.stringify({ nomeNegocio: cliente.nomeNegocio, cerebro }, null, 2))
    console.log(`Cérebro de ${cliente.nomeNegocio} salvo em ${caminho}`)
    return
  }

  await rodar(comando, lerOpcoes(resto))
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
