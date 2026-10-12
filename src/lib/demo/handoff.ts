import { assuntoHandoff, camposDoLead } from '@/lib/integrations/resend/handoff-campos'

// Na demo não existe telefone do lead: o card mostra um contato fixo
export const CONTATO_DEMO = '(21) 9XXXX-XXXX'

export type CardHandoff = {
  para: string
  assunto: string
  nome: string
  contato: string
  intencao: string
  resumo: string
  // Campos do pedido (T9), na ordem do cadastro
  campos: { nome: string; valor: string }[]
  quando: string
}

export function montarCardHandoff(args: {
  emailExibicao: string
  nomeNegocio: string
  leadNome: string | null
  leadIntencao: string | null
  leadResumo: string | null
  campos: { nome: string; valor: string }[]
  quando: Date
}): CardHandoff {
  const campos = camposDoLead({
    emailPrestador: args.emailExibicao,
    nomeNegocio: args.nomeNegocio,
    leadNome: args.leadNome,
    leadContato: CONTATO_DEMO,
    leadIntencao: args.leadIntencao,
    leadResumo: args.leadResumo,
    campos: args.campos,
    quando: args.quando,
  })
  return {
    para: args.emailExibicao,
    assunto: assuntoHandoff(args.quando),
    ...campos,
    campos: args.campos,
  }
}
