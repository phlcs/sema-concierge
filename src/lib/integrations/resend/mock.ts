import type { ResendAdapter, BookingConfirmationInput, EmailResult } from './types'

export const resendMock: ResendAdapter = {
  async sendBookingConfirmation(_input: BookingConfirmationInput): Promise<EmailResult> {
    const id = `mock-email-${crypto.randomUUID().slice(0, 8)}`
    return { id, success: true }
  },
}
