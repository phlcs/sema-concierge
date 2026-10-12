// Bateria de personas (T6). Roda fora do site, sob demanda, contra o ambiente de dev:
// uma IA faz o papel do cliente e o Concierge responde pela porta da bateria
// (/api/bateria), com o mesmo motor e o mesmo cérebro do link de teste.
//
// Uso (detalhes no README, seção "Bateria de personas"):
//   npm run bateria -- listar
//   npm run bateria -- cerebro <cliente>
//   npm run bateria -- <cliente> [--persona id,id] [--arquetipo id] [--repeticoes N]
//                                [--max-turnos N] [--paralelo N]
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

// ─── Tipos dos arquivos de persona ──────────────────────────────────────────

type Arquetipo = { id: string; nome: string; comportamento: string; origem?: string }

type Regra = { nome: string; padrao: string }

type Busca = {
  id: string
  persona: string
  arquetipo: string
  tipo?: string
  quem: string
  objetivo: string
  roteiro: string[]
  // true: tem que gerar card | false: não pode gerar card | "opcional": tanto faz
  esperaEncaminhamento: boolean | 'opcional'
  // Bloqueio do filtro de entrada é esperado (ex.: ataque de injeção)
  esperaBloqueio?: boolean
  // O que o card tem que trazer (resumo + intenção + nome), em expressão regular
  cardDeveConter?: Regra[]
  // O que o card não pode trazer
  cardNaoPodeConter?: Regra[]
  // O que a fala do Concierge não pode ter nesta persona
  falaNaoPodeConter?: Regra[]
  // O que alguma fala do Concierge tem que ter nesta persona
  falaDeveConter?: Regra[]
  // Critérios para a leitura crítica (não entram no placar automático)
  criterios: string[]
  maxTurnos?: number
}

type ArquivoCliente = {
  cliente: string
  nomeNoCadastro: string
  observacoes?: string
  checagens?: { falaNaoPodeConter?: Regra[] }
  buscas: Busca[]
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
  busca: string
  persona: string
  arquetipo: string
  repeticao: number
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
  personas: string[] | null
  arquetipo: string | null
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
  const personas = valor('persona')
  return {
    personas: personas ? personas.split(',').map((p) => p.trim()) : null,
    arquetipo: valor('arquetipo'),
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

  private prompt(busca: Busca, arquetipo: Arquetipo, maxTurnos: number): string {
    const roteiro = busca.roteiro.map((m, i) => `${i + 1}. ${m}`).join('\n')
    return [
      'Você é um cliente conversando pelo WhatsApp com o atendimento de uma empresa.',
      'Você está testando o atendimento, mas NUNCA revela isso: aja como uma pessoa real.',
      '',
      `QUEM VOCÊ É: ${busca.quem}`,
      `SEU JEITO (${arquetipo.nome}): ${arquetipo.comportamento}`,
      `O QUE VOCÊ QUER: ${busca.objetivo}`,
      '',
      'ROTEIRO (mensagens-chave, nesta ordem). A primeira já foi enviada. Use as seguintes quase com as',
      'mesmas palavras, adaptando só o necessário ao que o atendente respondeu. Entre uma e outra você pode',
      'reagir ao que ele disse, do seu jeito, mas não invente pedidos fora do roteiro e do seu objetivo.',
      roteiro,
      '',
      'REGRAS:',
      '- Escreva só a próxima mensagem do cliente, sem aspas, sem explicação, sem nome na frente.',
      '- Mensagens curtas, como no WhatsApp (até 3 frases), salvo se o roteiro mandar diferente.',
      `- Quando o roteiro acabar e a conversa tiver chegado a um fim natural, responda só ${FIM}.`,
      `- A conversa tem no máximo ${maxTurnos} mensagens suas.`,
    ].join('\n')
  }

  async proximaMensagem(busca: Busca, arquetipo: Arquetipo, turnos: Turno[], maxTurnos: number) {
    // Do ponto de vista do simulador, o Concierge é o "user" e ele é o "assistant"
    const mensagens = turnos.map((t) => ({
      role: t.role === 'user' ? ('assistant' as const) : ('user' as const),
      content: t.texto,
    }))
    const resposta = await this.client.messages.create(
      {
        model: this.modelo,
        max_tokens: 400,
        temperature: 0.7,
        system: this.prompt(busca, arquetipo, maxTurnos),
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

function checar(busca: Busca, arquivo: ArquivoCliente, turnos: Turno[], card: Card | null): Falha[] {
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
    if (erro && !(busca.esperaBloqueio && t.bloqueio)) falar('erro', `${onde}: ${erro}`)

    const perguntas = (semLinks(texto).match(/\?/g) ?? []).length
    if (perguntas > 1) falar('duas_perguntas', `${onde}: ${perguntas} perguntas na mesma mensagem`)

    if (/[—–]/.test(texto)) falar('travessao', `${onde}: usou travessão`)

    if (/assistente virtual|virtual assistant/i.test(texto) && !perguntouSeEIa) {
      falar('assistente_virtual', `${onde}: disse "assistente virtual" sem o cliente perguntar`)
    }

    if (cardJaSaiu) {
      if (VAI_ENCAMINHAR.test(texto)) {
        falar('vou_encaminhar_depois', `${onde}: disse que vai encaminhar, mas o pedido já tinha sido encaminhado`)
      }
      if (DIZ_QUE_ATUALIZOU.test(texto)) {
        falar(
          'fala_sem_card',
          `${onde}: deu a entender que anotou ou que o time vai saber de uma mudança, mas o card não é atualizado`,
        )
      }
    } else if (!t.encaminhou && DIZ_QUE_ENCAMINHOU.test(texto)) {
      falar('fala_sem_card', `${onde}: disse que encaminhou ou anotou, mas nenhum card foi gerado`)
    }

    if (t.encaminhou && !cardJaSaiu) cardJaSaiu = true
  }

  if (busca.esperaEncaminhamento === true && !card) {
    falar('encaminhamento', 'devia ter encaminhado e não encaminhou')
  }
  if (busca.esperaEncaminhamento === false && card) {
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
    for (const r of busca.cardDeveConter ?? []) {
      if (!new RegExp(r.padrao, 'i').test(conteudo)) falar('card_cliente', `card sem ${r.nome}`)
    }
    for (const r of busca.cardNaoPodeConter ?? []) {
      if (new RegExp(r.padrao, 'i').test(conteudo)) falar('card_cliente', `card com ${r.nome}`)
    }
  }

  const proibidas = [...(arquivo.checagens?.falaNaoPodeConter ?? []), ...(busca.falaNaoPodeConter ?? [])]
  falasConcierge.forEach((texto, i) => {
    for (const r of proibidas) {
      if (new RegExp(r.padrao, 'i').test(texto)) falar('regra_cliente', `resposta ${i + 1}: ${r.nome}`)
    }
  })
  const tudo = falasConcierge.join('\n')
  for (const r of busca.falaDeveConter ?? []) {
    if (!new RegExp(r.padrao, 'i').test(tudo)) falar('regra_cliente', `nenhuma resposta trouxe ${r.nome}`)
  }

  return falhas
}

// ─── Conversa ───────────────────────────────────────────────────────────────

async function conversar(args: {
  porta: Porta
  simulador: Simulador
  clienteId: string
  arquivo: ArquivoCliente
  busca: Busca
  arquetipo: Arquetipo
  repeticao: number
  maxTurnos: number
  versao: { provedor: string | null; modelo: string | null; versaoPrompt: string | null }
}): Promise<Resultado> {
  const { porta, simulador, clienteId, arquivo, busca, arquetipo, repeticao } = args
  const maxTurnos = busca.maxTurnos ?? args.maxTurnos
  const turnos: Turno[] = []
  let card: Card | null = null
  let fim: Resultado['fim'] = 'limite_de_turnos'
  let erroExecucao: string | null = null

  try {
    let mensagem = busca.roteiro[0]
    for (let i = 0; i < maxTurnos; i++) {
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

      if (i === maxTurnos - 1) break
      const proxima = await simulador.proximaMensagem(busca, arquetipo, turnos, maxTurnos)
      if (!proxima || proxima.includes(FIM)) {
        fim = 'cliente_encerrou'
        break
      }
      mensagem = proxima
    }
  } catch (err) {
    fim = 'erro'
    erroExecucao = err instanceof Error ? err.message : String(err)
  }

  const falhas = erroExecucao
    ? [{ checagem: 'execucao', motivo: `a conversa não terminou: ${erroExecucao}` }]
    : checar(busca, arquivo, turnos, card)

  const sufixo = repeticao > 1 ? `-r${repeticao}` : ''
  return {
    arquivo: `${busca.id}${arquetipo.id !== busca.arquetipo ? `-${arquetipo.id}` : ''}${sufixo}.md`,
    busca: busca.id,
    persona: busca.persona,
    arquetipo: arquetipo.id,
    repeticao,
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

function conversaEmTexto(r: Resultado, busca: Busca, arquetipo: Arquetipo): string {
  const linhas: string[] = [
    `# ${busca.persona} (${busca.id}) | ${arquetipo.nome}${r.repeticao > 1 ? ` | repetição ${r.repeticao}` : ''}`,
    '',
    `- **Quem é:** ${busca.quem}`,
    `- **Objetivo:** ${busca.objetivo}`,
    `- **Encaminhamento esperado:** ${busca.esperaEncaminhamento === 'opcional' ? 'tanto faz' : busca.esperaEncaminhamento ? 'sim' : 'não'}`,
    `- **Fim:** ${r.fim.replace(/_/g, ' ')}`,
    `- **Placar:** ${r.falhas.length === 0 ? 'passou' : `${r.falhas.length} falha(s)`}`,
    '',
    '## Conversa',
    '',
  ]
  let n = 0
  for (const t of r.turnos) {
    if (t.role === 'user') {
      linhas.push(`**Cliente:** ${t.texto}`, '')
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
  linhas.push('', '## Critérios para a leitura crítica', '', ...busca.criterios.map((c) => `- ${c}`), '')
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
    '| Persona | Arquétipo | Card | Resultado | Motivos |',
    '|---|---|---|---|---|',
    ...resultados.map((r) => {
      const motivos = r.falhas.map((f) => `${f.checagem}: ${f.motivo}`).join('<br>') || '-'
      return `| [${r.persona}${r.repeticao > 1 ? ` (r${r.repeticao})` : ''}](${r.arquivo}) | ${r.arquetipo} | ${r.card ? 'sim' : 'não'} | ${r.falhas.length === 0 ? '✅' : '❌'} | ${motivos.replace(/\|/g, '/')} |`
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
  const caminhoCliente = join(PASTA, 'clientes', `${slug}.json`)
  if (!existsSync(caminhoCliente)) {
    console.error(`Não achei bateria/clientes/${slug}.json`)
    process.exit(1)
  }
  const arquivo = lerJson<ArquivoCliente>(caminhoCliente)
  const arquetipos = lerJson<Arquetipo[]>(join(PASTA, 'arquetipos.json'))
  const porId = new Map(arquetipos.map((a) => [a.id, a]))

  const porta = new Porta(exigirVariavel('BATERIA_URL'), exigirVariavel('BATERIA_TOKEN'))
  const modeloSimulador = process.env.BATERIA_MODELO?.trim() || MODELO_PADRAO
  const simulador = new Simulador(exigirVariavel('BATERIA_ANTHROPIC_KEY'), modeloSimulador)

  const buscas = arquivo.buscas.filter((b) => !opcoes.personas || opcoes.personas.includes(b.id))
  if (buscas.length === 0) {
    console.error(`Nenhuma persona com esse id. Disponíveis: ${arquivo.buscas.map((b) => b.id).join(', ')}`)
    process.exit(1)
  }
  if (opcoes.arquetipo && !porId.has(opcoes.arquetipo)) {
    console.error(`Arquétipo desconhecido. Disponíveis: ${arquetipos.map((a) => a.id).join(', ')}`)
    process.exit(1)
  }

  const cliente = await acharCliente(porta, arquivo.nomeNoCadastro)
  const pastaRodada = carimbo(new Date())
  const destino = join(PASTA, 'resultados', slug, pastaRodada)
  mkdirSync(destino, { recursive: true })

  const tarefas = buscas.flatMap((busca) => {
    const arquetipo = porId.get(opcoes.arquetipo ?? busca.arquetipo)
    if (!arquetipo) throw new Error(`Persona ${busca.id}: arquétipo "${busca.arquetipo}" não existe`)
    return Array.from({ length: opcoes.repeticoes }, (_, i) => ({ busca, arquetipo, repeticao: i + 1 }))
  })

  console.log(`Bateria ${cliente.nomeNegocio}: ${tarefas.length} conversa(s), resultados em bateria/resultados/${slug}/${pastaRodada}`)
  const versao = { provedor: null as string | null, modelo: null as string | null, versaoPrompt: null as string | null }

  const resultados = await emParalelo(tarefas, opcoes.paralelo, async ({ busca, arquetipo, repeticao }) => {
    const r = await conversar({
      porta,
      simulador,
      clienteId: cliente.id,
      arquivo,
      busca,
      arquetipo,
      repeticao,
      maxTurnos: opcoes.maxTurnos,
      versao,
    })
    writeFileSync(join(destino, r.arquivo), conversaEmTexto(r, busca, arquetipo))
    console.log(`  ${r.falhas.length === 0 ? 'ok   ' : 'FALHA'} ${busca.persona} (${r.arquivo})`)
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
