'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

type Props = {
  id: string
  nomeNegocio: string
  token: string
  // ISO, só quando ainda está liberado; nulo = bloqueado (ou já venceu)
  liberadoAte: string | null
}

const formatoData = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

// Link de teste do cliente (T7): mostra a situação, libera por 7 dias, bloqueia e copia o link
export default function LinkTeste({ id, nomeNegocio, token, liberadoAte }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)
  const [ateLocal, setAteLocal] = useState(liberadoAte)

  const liberado = ateLocal !== null

  async function aplicar(acao: 'liberar' | 'bloquear') {
    setErro(null)
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/clientes/${id}/liberar-teste`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao }),
      })
      if (!res.ok) {
        let msg = 'Falha ao alterar o link.'
        try {
          const data = (await res.json()) as { message?: string; error?: string }
          msg = data.message || data.error || msg
        } catch {}
        setErro(msg)
        return
      }
      const data = (await res.json()) as { testeLiberadoAte: string | null }
      setAteLocal(data.testeLiberadoAte)
      startTransition(() => router.refresh())
    } catch {
      setErro('Erro de rede.')
    } finally {
      setLoading(false)
    }
  }

  function onLiberar() {
    if (loading || pending) return
    void aplicar('liberar')
  }

  function onBloquear() {
    if (loading || pending) return
    const ok = window.confirm(`Bloquear agora o link de teste de "${nomeNegocio}"?`)
    if (!ok) return
    void aplicar('bloquear')
  }

  async function onCopiar() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/demo/${token}`)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      setErro('Não deu para copiar.')
    }
  }

  return (
    <div className="link-teste">
      <span className="status-cell">
        <span className={liberado ? 'dot ativo' : 'dot outro'} aria-hidden />
        {ateLocal !== null ? `Liberado até ${formatoData.format(new Date(ateLocal))}` : 'Bloqueado'}
      </span>
      <div className="toggle-cell">
        {liberado ? (
          <button
            type="button"
            className="btn-toggle on"
            onClick={onBloquear}
            disabled={loading || pending}
          >
            {loading ? '…' : 'Bloquear'}
          </button>
        ) : null}
        <button
          type="button"
          className="btn-toggle off"
          onClick={onLiberar}
          disabled={loading || pending}
          title="Libera por 7 dias a partir de agora e zera o limite de mensagens"
        >
          {loading ? '…' : liberado ? 'Renovar 7 dias' : 'Liberar por 7 dias'}
        </button>
        <button type="button" className="btn-toggle" onClick={onCopiar}>
          {copiado ? 'Copiado' : 'Copiar link'}
        </button>
      </div>
      {erro ? <span className="error inline">{erro}</span> : null}
    </div>
  )
}
