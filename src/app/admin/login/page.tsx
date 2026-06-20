'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function AdminLoginPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (!res.ok) {
        setError('senha incorreta')
        setLoading(false)
        return
      }
      router.replace('/admin')
      router.refresh()
    } catch {
      setError('senha incorreta')
      setLoading(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="card">
        <h1>Painel Sema</h1>
        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="password">Senha</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button type="submit" disabled={loading}>
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
          {error && <div className="error">{error}</div>}
        </form>
      </div>
    </div>
  )
}
