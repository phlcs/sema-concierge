import { logger } from '@/lib/logger'
import { assuntoEncaminhamento } from '@/lib/atendimento/pacote'
import type {
  ResendAdapter,
  BookingConfirmationInput,
  EncaminhamentoEmail,
  EmailResult,
} from './types'

export const resendMock: ResendAdapter = {
  async sendBookingConfirmation(_input: BookingConfirmationInput): Promise<EmailResult> {
    const id = `mock-email-${crypto.randomUUID().slice(0, 8)}`
    return { id, success: true }
  },

  async enviarEncaminhamento(input: EncaminhamentoEmail): Promise<EmailResult> {
    const id = `mock-encaminhamento-${crypto.randomUUID().slice(0, 8)}`
    const { pacote } = input
    logger.info('[resend mock] enviarEncaminhamento', {
      id,
      para: input.para,
      remetente: input.remetente,
      assunto: assuntoEncaminhamento(pacote),
      tipo: pacote.tipo,
      nomeNegocio: pacote.nomeNegocio,
      contato: pacote.contato,
      campos: pacote.campos,
      resumo: pacote.resumo,
      mudou: pacote.mudou,
      alteracoes: pacote.alteracoes,
      quando: pacote.quando.toISOString(),
    })
    return { id, success: true }
  },
}
