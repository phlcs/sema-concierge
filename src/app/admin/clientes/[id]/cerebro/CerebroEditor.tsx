'use client'

import { useState } from 'react'

type Props = {
  id: string
  nomeNegocio: string
  cerebroAtual: string
}

export default function CerebroEditor({ id, nomeNegocio, cerebroAtual }: Props) {
  const [atual, setAtual] = useState(cerebroAtual)
  const [rascunho, setRascunho] = useState(cerebroAtual)
  const [erro, setErro] = useState<string | null>(null)
  const [sucesso, setSucesso] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const sujo = rascunho !== atual

  async function onSalvar() {
    if (loading) return
    setErro(null)
    setSucesso(null)

    // Validação no front (conveniência) — servidor revalida.
    try {
      JSON.parse(rascunho)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'JSON inválido.'
      setErro(`JSON inválido: ${msg}`)
      return
    }

    const ok = window.confirm(
      `Salvar o novo cérebro de "${nomeNegocio}"?\nIsso muda o comportamento do bot.`,
    )
    if (!ok) return

    setLoading(true)
    try {
      const res = await fetch(`/api/admin/clientes/${id}/cerebro`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cerebro: rascunho }),
      })
      if (!res.ok) {
        let msg = 'Falha ao salvar.'
        try {
          const data = (await res.json()) as { message?: string; error?: string }
          msg = data.message || data.error || msg
        } catch {}
        setErro(msg)
        return
      }
      // Re-formatar pro mesmo padrão indentado (o que foi gravado é o objeto parseado).
      const formatado = JSON.stringify(JSON.parse(rascunho), null, 2)
      setAtual(formatado)
      setRascunho(formatado)
      setSucesso('Cérebro salvo.')
    } catch {
      setErro('Erro de rede.')
    } finally {
      setLoading(false)
    }
  }

  function onResetar() {
    if (loading) return
    if (!sujo) return
    const ok = window.confirm('Descartar suas edições e voltar ao cérebro atual?')
    if (!ok) return
    setRascunho(atual)
    setErro(null)
    setSucesso(null)
  }

  return (
    <div className="cerebro-wrap">
      <div className="cerebro-grid">
        <section className="card cerebro-panel">
          <header className="cerebro-panel-head">
            <h2>Cérebro atual</h2>
            <span className="muted">Em produção · somente leitura</span>
          </header>
          <pre className="cerebro-view" aria-label="Cérebro atual em produção">
            {atual}
          </pre>
        </section>

        <section className="card cerebro-panel">
          <header className="cerebro-panel-head">
            <h2>Editor {sujo ? <span className="badge-dirty">modificado</span> : null}</h2>
            <span className="muted">Validação só checa se é JSON válido</span>
          </header>
          <textarea
            className="cerebro-edit"
            value={rascunho}
            onChange={(e) => {
              setRascunho(e.target.value)
              setErro(null)
              setSucesso(null)
            }}
            spellCheck={false}
            aria-label="Rascunho do novo cérebro"
          />
        </section>
      </div>

      {erro ? <p className="error">{erro}</p> : null}
      {sucesso ? <p className="success">{sucesso}</p> : null}

      <div className="cerebro-actions">
        <button type="button" onClick={onSalvar} disabled={loading || !sujo}>
          {loading ? 'Salvando…' : 'Salvar cérebro'}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={onResetar}
          disabled={loading || !sujo}
        >
          Descartar edição
        </button>
      </div>
    </div>
  )
}
