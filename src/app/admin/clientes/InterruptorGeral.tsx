'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

type Props = {
  ligado: boolean
  // Texto já formatado no servidor (ex.: "11/10/2026 14:32")
  ligadoEm: string | null
  afetados: number
}

export default function InterruptorGeral({ ligado, ligadoEm, afetados }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [loading, setLoading] = useState(false)
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const ocupado = loading || pending

  async function enviar(corpo: { acao: 'ligar'; senha: string } | { acao: 'desligar' }) {
    setErro(null)
    setAviso(null)
    setLoading(true)
    try {
      const res = await fetch('/api/admin/interruptor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
      })
      const data = (await res.json().catch(() => ({}))) as {
        message?: string
        error?: string
        afetados?: number
        restaurados?: number
      }
      if (!res.ok) {
        setErro(data.message || data.error || 'Falha ao alterar o interruptor.')
        return
      }
      setSenha('')
      setAviso(
        corpo.acao === 'ligar'
          ? `Interruptor ligado: ${data.afetados ?? 0} cliente(s) colocado(s) em manutenção.`
          : `Voltou ao normal: ${data.restaurados ?? 0} cliente(s) reativado(s).`,
      )
      startTransition(() => router.refresh())
    } catch {
      setErro('Erro de rede.')
    } finally {
      setLoading(false)
    }
  }

  function ligar(e: React.FormEvent) {
    e.preventDefault()
    if (ocupado || !senha) return
    const ok = window.confirm(
      'Tem certeza? TODOS os clientes ativos vão parar de ser atendidos pela IA agora e passarão a responder só a mensagem de manutenção.',
    )
    if (!ok) return
    void enviar({ acao: 'ligar', senha })
  }

  function desligar() {
    if (ocupado) return
    const ok = window.confirm(
      `Voltar ao normal? Os ${afetados} cliente(s) que o interruptor geral colocou em manutenção voltam a ser atendidos. Quem já estava em manutenção antes, ou teve o botão mexido à mão, continua como está.`,
    )
    if (!ok) return
    void enviar({ acao: 'desligar' })
  }

  return (
    <div className={ligado ? 'card interruptor on' : 'card interruptor'}>
      <h2 className="interruptor-titulo">
        Interruptor geral de manutenção{' '}
        <span className={ligado ? 'badge-geral on' : 'badge-geral'}>{ligado ? 'LIGADO' : 'desligado'}</span>
      </h2>

      {ligado ? (
        <>
          <p className="muted">
            Ligado desde {ligadoEm ?? '—'}. {afetados} cliente(s) foram colocados em manutenção por ele
            e estão respondendo só a mensagem de manutenção. O botão de cada cliente, na tabela abaixo,
            continua valendo: se você religar um cliente à mão, ele fica ativo.
          </p>
          <div className="interruptor-acoes">
            <button type="button" onClick={desligar} disabled={ocupado}>
              {ocupado ? '…' : 'Voltar ao normal'}
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={ligar}>
          <p className="muted">
            Coloca <strong>todos os clientes ativos</strong> em manutenção de uma vez: a IA para de
            atender e quem escrever recebe só a mensagem de manutenção. Clientes que já estão em
            manutenção não são mexidos. Para confirmar, digite a senha do painel de novo.
          </p>
          <div className="interruptor-acoes">
            <input
              type="password"
              autoComplete="current-password"
              placeholder="Senha do painel"
              aria-label="Senha do painel"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              disabled={ocupado}
            />
            <button type="submit" className="btn-perigo" disabled={ocupado || !senha}>
              {ocupado ? '…' : 'Colocar todos em manutenção'}
            </button>
          </div>
        </form>
      )}

      {erro ? <div className="error">{erro}</div> : null}
      {aviso ? <div className="success">{aviso}</div> : null}
    </div>
  )
}
