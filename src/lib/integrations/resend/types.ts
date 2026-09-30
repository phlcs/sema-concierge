export type BookingConfirmationInput = {
  to: string
  userName: string
  scheduledAt: Date
  meetUrl: string
}

export type HandoffInput = {
  emailPrestador: string
  nomeNegocio: string
  leadNome: string | null
  leadContato: string
  leadIntencao: string | null
  leadResumo: string | null
  quando: Date
}

export type EmailResult = {
  id: string
  success: boolean
}

export interface ResendAdapter {
  sendBookingConfirmation(input: BookingConfirmationInput): Promise<EmailResult>
  enviarHandoff(input: HandoffInput): Promise<EmailResult>
}
