export const COOKIE_SESSAO = 'sema_demo_sessao'

const FORMATO_SESSAO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function sessaoValida(valor: string | undefined): string | null {
  return valor && FORMATO_SESSAO.test(valor) ? valor : null
}

export function novaSessao(): string {
  return crypto.randomUUID()
}

export function opcoesCookieSessao(token: string, expiraEm: Date) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: `/demo/${token}`,
    expires: expiraEm,
  }
}
