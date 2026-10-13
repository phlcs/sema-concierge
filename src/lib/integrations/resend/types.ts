import type { PacoteEncaminhamento } from '@/lib/atendimento/pacote'

export type BookingConfirmationInput = {
  to: string
  userName: string
  scheduledAt: Date
  meetUrl: string
}

// E-mail de encaminhamento (T10): novo, atualização ou cancelamento
export type EncaminhamentoEmail = {
  para: string
  // Nome do remetente (do cadastro); o endereço vem de RESEND_FROM_EMAIL
  remetente: string
  pacote: PacoteEncaminhamento
}

export type EmailResult = {
  id: string
  success: boolean
}

export interface ResendAdapter {
  sendBookingConfirmation(input: BookingConfirmationInput): Promise<EmailResult>
  enviarEncaminhamento(input: EncaminhamentoEmail): Promise<EmailResult>
}
