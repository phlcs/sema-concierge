import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Entrar na sua conta',
  description: 'Entre ou crie sua conta gratuita para acessar o assistente de contabilidade.',
  robots: { index: false, follow: false },
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children
}
