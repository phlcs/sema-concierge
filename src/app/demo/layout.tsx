import type { Metadata } from 'next'
import './demo.css'

export const metadata: Metadata = {
  title: 'Demonstração',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return <div className="sema-demo">{children}</div>
}
