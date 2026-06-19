import { logger } from '@/lib/logger'
import type {
  ResendAdapter,
  BookingConfirmationInput,
  HandoffInput,
  EmailResult,
} from './types'

export const resendMock: ResendAdapter = {
  async sendBookingConfirmation(_input: BookingConfirmationInput): Promise<EmailResult> {
    const id = `mock-email-${crypto.randomUUID().slice(0, 8)}`
    return { id, success: true }
  },

  async enviarHandoff(input: HandoffInput): Promise<EmailResult> {
    const id = `mock-handoff-${crypto.randomUUID().slice(0, 8)}`
    logger.info('[resend mock] enviarHandoff', {
      id,
      emailPrestador: input.emailPrestador,
      nomeNegocio: input.nomeNegocio,
      leadNome: input.leadNome,
      leadContato: input.leadContato,
      leadIntencao: input.leadIntencao,
      leadResumo: input.leadResumo,
      quando: input.quando.toISOString(),
    })
    return { id, success: true }
  },
}
