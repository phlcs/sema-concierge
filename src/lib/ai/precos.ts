// Tabela de preços para o custo ESTIMADO de cada chamada de IA (T5). Valores em
// dólar por milhão de tokens, conforme as páginas públicas de preço de cada
// provedor (conferidas em 2026-10-12, camada padrão). É estimativa: não considera
// descontos de contrato, processamento em lote nem recursos extras. Para atualizar
// um preço ou incluir um modelo, é só mexer nesta tabela.
//
// A chave é o início do nome do modelo; vale a chave mais longa que casar (assim
// "claude-haiku-4-5-20251001" usa "claude-haiku-4-5" e "gpt-5.4-mini" não cai em
// "gpt-5.4"). Modelo fora da tabela fica sem custo (null), nunca com chute.

export type Preco = {
  entrada: number
  leituraCache: number
  // Só a Anthropic cobra a gravação no cache à parte; nos demais a entrada já inclui
  escritaCache?: number
  saida: number
  // Preço da faixa de prompt longo, quando o provedor cobra diferente
  promptLongo?: { acimaDeTokens: number; preco: Omit<Preco, 'promptLongo'> }
}

const ANTHROPIC: Record<string, Preco> = {
  'claude-fable-5-1': { entrada: 10, escritaCache: 12.5, leituraCache: 0.25, saida: 50 },
  'claude-fable-5': { entrada: 10, escritaCache: 12.5, leituraCache: 1, saida: 50 },
  'claude-opus-5-5': { entrada: 4, escritaCache: 5, leituraCache: 0.2, saida: 20 },
  'claude-opus-5': { entrada: 5, escritaCache: 6.25, leituraCache: 0.5, saida: 25 },
  'claude-opus-4-8': { entrada: 5, escritaCache: 6.25, leituraCache: 0.5, saida: 25 },
  'claude-opus-4-7': { entrada: 5, escritaCache: 6.25, leituraCache: 0.5, saida: 25 },
  'claude-opus-4-6': { entrada: 5, escritaCache: 6.25, leituraCache: 0.5, saida: 25 },
  'claude-opus-4-5': { entrada: 5, escritaCache: 6.25, leituraCache: 0.5, saida: 25 },
  'claude-sonnet-5-5': { entrada: 2, escritaCache: 2.5, leituraCache: 0.1, saida: 10 },
  'claude-sonnet-5': { entrada: 2, escritaCache: 2.5, leituraCache: 0.2, saida: 10 },
  'claude-sonnet-4': { entrada: 3, escritaCache: 3.75, leituraCache: 0.3, saida: 15 },
  'claude-haiku-5-5': {
    entrada: 0.1,
    escritaCache: 0.125,
    leituraCache: 0.01,
    saida: 0.5,
    promptLongo: {
      acimaDeTokens: 100_000,
      preco: { entrada: 0.5, escritaCache: 0.625, leituraCache: 0.05, saida: 2.5 },
    },
  },
  'claude-haiku-4-5': { entrada: 1, escritaCache: 1.25, leituraCache: 0.1, saida: 5 },
}

const GEMINI: Record<string, Preco> = {
  'gemini-2.5-flash-lite': { entrada: 0.1, leituraCache: 0.01, saida: 0.4 },
  'gemini-2.5-flash': { entrada: 0.3, leituraCache: 0.03, saida: 2.5 },
  'gemini-2.5-pro': {
    entrada: 1.25,
    leituraCache: 0.125,
    saida: 10,
    promptLongo: {
      acimaDeTokens: 200_000,
      preco: { entrada: 2.5, leituraCache: 0.25, saida: 15 },
    },
  },
}

const OPENAI: Record<string, Preco> = {
  'gpt-6-luna': {
    entrada: 0.1,
    leituraCache: 0.01,
    saida: 0.5,
    promptLongo: {
      acimaDeTokens: 272_000,
      preco: { entrada: 0.2, leituraCache: 0.02, saida: 0.75 },
    },
  },
  'gpt-5.6-luna': {
    entrada: 0.2,
    leituraCache: 0.02,
    saida: 1.2,
    promptLongo: {
      acimaDeTokens: 272_000,
      preco: { entrada: 0.4, leituraCache: 0.04, saida: 1.8 },
    },
  },
  'gpt-5.4-mini': { entrada: 0.75, leituraCache: 0.075, saida: 4.5 },
  'gpt-5.4': { entrada: 2.5, leituraCache: 0.25, saida: 15 },
  'gpt-5-mini': { entrada: 0.25, leituraCache: 0.025, saida: 2 },
  'gpt-4o-mini': { entrada: 0.15, leituraCache: 0.075, saida: 0.6 },
}

const TABELAS: Record<string, Record<string, Preco>> = {
  anthropic: ANTHROPIC,
  gemini: GEMINI,
  openai: OPENAI,
}

// Transcrição: a OpenAI publica o valor estimado por minuto de áudio
const TRANSCRICAO_USD_POR_MINUTO: Record<string, number> = {
  'gpt-4o-mini-transcribe': 0.003,
}
// Sem a duração, estima pelos tokens (entrada e saída) do próprio retorno
const TRANSCRICAO_TOKENS: Record<string, { entrada: number; saida: number }> = {
  'gpt-4o-mini-transcribe': { entrada: 1.25, saida: 5 },
}

function porPrefixo<T>(tabela: Record<string, T>, modelo: string): T | null {
  const nome = modelo.trim().toLowerCase()
  const chave = Object.keys(tabela)
    .filter((k) => nome.startsWith(k))
    .sort((a, b) => b.length - a.length)[0]
  return chave ? tabela[chave] : null
}

export type UsoTokens = {
  // Total de entrada, já contando o que veio do cache
  tokensEntrada: number | null
  tokensSaida: number | null
  tokensCache: number | null
  tokensCacheEscrita: number | null
}

const MILHAO = 1_000_000

export function estimarCustoUsd(provedor: string, modelo: string, uso: UsoTokens): number | null {
  const tabela = TABELAS[provedor]
  if (!tabela || uso.tokensEntrada == null || uso.tokensSaida == null) return null
  const base = porPrefixo(tabela, modelo)
  if (!base) return null

  const entrada = uso.tokensEntrada
  const preco =
    base.promptLongo && entrada > base.promptLongo.acimaDeTokens ? base.promptLongo.preco : base
  const lidos = Math.min(uso.tokensCache ?? 0, entrada)
  const escritos = Math.min(uso.tokensCacheEscrita ?? 0, entrada - lidos)
  const comuns = entrada - lidos - escritos

  const usd =
    (comuns * preco.entrada +
      lidos * preco.leituraCache +
      escritos * (preco.escritaCache ?? preco.entrada) +
      uso.tokensSaida * preco.saida) /
    MILHAO
  return Math.round(usd * 1e8) / 1e8
}

export function estimarCustoTranscricaoUsd(
  modelo: string,
  args: { segundos: number | null; tokensEntrada: number | null; tokensSaida: number | null },
): number | null {
  const porMinuto = porPrefixo(TRANSCRICAO_USD_POR_MINUTO, modelo)
  if (porMinuto != null && args.segundos != null) {
    return Math.round((args.segundos / 60) * porMinuto * 1e8) / 1e8
  }
  const porToken = porPrefixo(TRANSCRICAO_TOKENS, modelo)
  if (porToken && args.tokensEntrada != null && args.tokensSaida != null) {
    const usd = (args.tokensEntrada * porToken.entrada + args.tokensSaida * porToken.saida) / MILHAO
    return Math.round(usd * 1e8) / 1e8
  }
  return null
}
