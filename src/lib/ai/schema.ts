import { z } from 'zod'

export const AiResponseSchema = z.object({
  paragraphs: z.array(z.string()),
  checklist: z.array(z.string()).nullish(),
  steps: z
    .array(
      z.object({
        title: z.string(),
        description: z.string(),
      })
    )
    .nullish(),
  suggestBook: z.boolean(),
  bookReason: z.string().nullish(),
  leadNome: z.string().nullish(),
  leadIntencao: z.string().nullish(),
  leadResumo: z.string().nullish(),
})

export type AiResponse = z.infer<typeof AiResponseSchema>

export const FALLBACK_RESPONSE: AiResponse = {
  paragraphs: ['Tive uma instabilidade aqui, pode mandar a mensagem de novo?'],
  checklist: null,
  steps: null,
  suggestBook: false,
  bookReason: null,
  leadNome: null,
  leadIntencao: null,
  leadResumo: null,
}

export const MAINTENANCE_RESPONSE: AiResponse = {
  paragraphs: [
    'Este atendimento está temporariamente em manutenção. Por favor, tente novamente mais tarde.',
  ],
  checklist: null,
  steps: null,
  suggestBook: false,
  bookReason: null,
  leadNome: null,
  leadIntencao: null,
  leadResumo: null,
}

// Frase fixa para áudio, imagem, documento e vídeo (o bot só lê texto).
export const FRASE_MIDIA = 'Poxa, ainda não consigo ler imagens e arquivos. Consegue enviar escrito?'

// Resposta padrão quando o guardrail de saída detecta vazamento. Genérica de propósito:
// sem nome de pessoa/negócio/ramo e sem explicar o motivo.
export const LEAK_RESPONSE: AiResponse = {
  paragraphs: [
    'Posso te ajudar com informações sobre o nosso atendimento. O que você gostaria de saber?',
  ],
  checklist: null,
  steps: null,
  suggestBook: false,
  bookReason: null,
  leadNome: null,
  leadIntencao: null,
  leadResumo: null,
}

export const BLOCKED_RESPONSE: AiResponse = {
  paragraphs: [
    'Desculpa, não consegui entender. Pode reformular sua pergunta?',
  ],
  checklist: null,
  steps: null,
  suggestBook: false,
  bookReason: null,
  leadNome: null,
  leadIntencao: null,
  leadResumo: null,
}
