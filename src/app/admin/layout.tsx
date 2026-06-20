import type { Metadata } from 'next'
import './admin.css'

export const metadata: Metadata = {
  title: 'Painel Sema',
  robots: { index: false, follow: false },
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className="sema-admin">{children}</div>
}
