'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

type Props = {
  id: string
  nomeNegocio: string
  status: string
}

const ATIVO = 'ativo'
const MANUTENCAO = 'manutencao'

export default function StatusToggle({ id, nomeNegocio, status }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [statusLocal, setStatusLocal] = useState(status)

  const togglable = statusLocal === ATIVO || statusLocal === MANUTENCAO

  if (!togglable) {
    return <span className="muted">Trava: não alternável aqui</span>
  }

  const ligado = statusLocal === ATIVO
  const proximo = ligado ? MANUTENCAO : ATIVO

  async function aplicar(proximoStatus: string) {
    setErro(null)
    setLoading(true)
    const anterior = statusLocal
    setStatusLocal(proximoStatus)
    try {
      const res = await fetch(`/api/admin/clientes/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: proximoStatus }),
      })
      if (!res.ok) {
        let msg = 'Falha ao alterar status.'
        try {
          const data = (await res.json()) as { message?: string; error?: string }
          msg = data.message || data.error || msg
        } catch {}
        setStatusLocal(anterior)
        setErro(msg)
        return
      }
      startTransition(() => router.refresh())
    } catch {
      setStatusLocal(anterior)
      setErro('Erro de rede.')
    } finally {
      setLoading(false)
    }
  }

  function onClick() {
    if (loading || pending) return
    if (ligado) {
      const ok = window.confirm(
        `Tem certeza que quer colocar "${nomeNegocio}" em manutenção?\nO bot vai parar de atender normalmente.`,
      )
      if (!ok) return
    }
    void aplicar(proximo)
  }

  return (
    <div className="toggle-cell">
      <button
        type="button"
        className={ligado ? 'btn-toggle on' : 'btn-toggle off'}
        onClick={onClick}
        disabled={loading || pending}
        aria-pressed={ligado}
        title={ligado ? 'Desligar (entrar em manutenção)' : 'Ligar (voltar ao ativo)'}
      >
        {loading ? '…' : ligado ? 'Desligar' : 'Ligar'}
      </button>
      {erro ? <span className="error inline">{erro}</span> : null}
    </div>
  )
}
