import type { EncaminhamentoRegistrado, TipoEncaminhamento } from '@/lib/atendimento/encaminhamento'
import {
  assuntoEncaminhamento,
  corpoEncaminhamento,
  montarPacote,
  type CorpoEncaminhamento,
} from '@/lib/atendimento/pacote'

// Na demo não existe telefone do contato: o card mostra um contato fixo
export const CONTATO_DEMO = '(21) 9XXXX-XXXX'

// Card do link de teste: o mesmo e-mail que a equipe receberia (T10), sem enviar nada
export type CardHandoff = CorpoEncaminhamento & {
  tipo: TipoEncaminhamento
  para: string
  remetente: string
  assunto: string
}

export function montarCardHandoff(args: {
  emailExibicao: string
  remetente: string
  nomeNegocio: string
  encaminhamento: EncaminhamentoRegistrado
  quando: Date
}): CardHandoff {
  const pacote = montarPacote({
    nomeNegocio: args.nomeNegocio,
    contato: CONTATO_DEMO,
    encaminhamento: args.encaminhamento,
    quando: args.quando,
  })
  return {
    tipo: pacote.tipo,
    para: args.emailExibicao,
    remetente: args.remetente,
    assunto: assuntoEncaminhamento(pacote),
    ...corpoEncaminhamento(pacote),
  }
}
