// Ciclo de ferramentas da IA (T9). Quem chama o chatComplete diz quais
// ferramentas a IA pode usar e como executá-las; o provedor chama a ferramenta,
// devolve o resultado à IA e só então ela escreve a resposta final.
// Só a OpenAI usa ferramentas por enquanto; os outros provedores ignoram.

export type DefinicaoFerramenta = {
  nome: string
  descricao: string
  // JSON Schema dos argumentos
  parametros: Record<string, unknown>
}

export type Ferramentas = {
  definicoes: DefinicaoFerramenta[]
  // Devolve o texto que volta para a IA. Não deve lançar: erro vira texto.
  executar: (nome: string, args: unknown) => Promise<string>
}

// Rodadas em que a IA ainda pode chamar ferramenta; na seguinte ela é obrigada a responder.
// 4 desde a T14: buscar nos documentos, buscar de novo, registrar ou enviar, e folga.
export const MAX_RODADAS_FERRAMENTA = 4
