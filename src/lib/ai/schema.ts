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
  paragraphs: ['Tive um problema técnico ao processar sua pergunta. Tenta reformular?'],
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
    'Posso ajudar com dúvidas de Imposto de Renda e contabilidade pra pessoa física. Quer tirar alguma dúvida sobre isso?',
  ],
  checklist: null,
  steps: null,
  suggestBook: false,
  bookReason: null,
  leadNome: null,
  leadIntencao: null,
  leadResumo: null,
}
