import { resendMock } from './mock'
import { resendReal } from './real'
import type { ResendAdapter } from './types'

export type { ResendAdapter, BookingConfirmationInput, EmailResult } from './types'

const mode = process.env.RESEND_MODE ?? 'mock'
export const resend: ResendAdapter = mode === 'real' ? resendReal : resendMock
// 'mock' = nada sai de verdade (só registro); usado para marcar o evento de encaminhamento
export const resendModo: 'real' | 'mock' = mode === 'real' ? 'real' : 'mock'
