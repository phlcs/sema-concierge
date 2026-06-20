import { redirect } from 'next/navigation'
import { isAdminAuthed } from '@/lib/admin/guard'
import LogoutButton from './LogoutButton'

export default async function AdminHomePage() {
  if (!(await isAdminAuthed())) {
    redirect('/admin/login')
  }

  return (
    <div className="shell">
      <div className="topbar">
        <h1>Painel Sema</h1>
        <LogoutButton />
      </div>
      <div className="card">
        <p>Em construção.</p>
      </div>
    </div>
  )
}
