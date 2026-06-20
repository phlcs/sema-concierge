import { redirect } from 'next/navigation'
import { isAdminAuthed } from '@/lib/admin/guard'
import LogoutButton from './LogoutButton'

export default async function AdminHomePage() {
  if (!(await isAdminAuthed())) {
    redirect('/admin/login')
  }

  return (
    <>
      <div className="topbar">
        <span className="brand">Painel Sema</span>
        <LogoutButton />
      </div>
      <div className="shell">
        <h1>Visão geral</h1>
        <p className="muted">As seções do painel entram em breve.</p>
      </div>
    </>
  )
}
