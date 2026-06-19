import type { ResendAdapter } from './types'

export const resendReal: ResendAdapter = {
  async sendBookingConfirmation() {
    throw new Error('[resend real] not implemented yet — set RESEND_MODE=mock')
  },
  async enviarHandoff() {
    throw new Error('[resend real] not implemented yet — set RESEND_MODE=mock')
  },
}
