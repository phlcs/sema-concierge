'use client'

import { useState } from 'react'

export type MensagemDTO = {
  id: string
  role: 'USER' | 'ASSISTANT'
  texto: string
  createdAt: string
}

type Props = {
  clienteId: string
  conversaId: string
  mensagensIniciais: MensagemDTO[]
  temMaisInicial: boolean
}

const fmt = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
})

export default function MessagesReader({
  clienteId,
  conversaId,
  mensagensIniciais,
  temMaisInicial,
}: Props) {
  const [mensagens, setMensagens] = useState<MensagemDTO[]>(mensagensIniciais)
  const [temMais, setTemMais] = useState(temMaisInicial)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function carregarMaisAntigas() {
    if (carregando || !temMais || mensagens.length === 0) return
    setCarregando(true)
    setErro(null)
    try {
      const cursor = mensagens[0].id
      const r = await fetch(
        `/api/admin/clientes/${clienteId}/conversas/${conversaId}/mensagens?before=${encodeURIComponent(cursor)}`,
        { cache: 'no-store' },
      )
      if (!r.ok) {
        setErro('Não foi possível carregar mais mensagens.')
        return
      }
      const data = (await r.json()) as {
        mensagens: MensagemDTO[]
        hasMore: boolean
      }
      setMensagens((atual) => [...data.mensagens, ...atual])
      setTemMais(data.hasMore)
    } catch {
      setErro('Não foi possível carregar mais mensagens.')
    } finally {
      setCarregando(false)
    }
  }

  return (
    <div className="chat-wrap">
      <div className="chat-topbar">
        {temMais ? (
          <button
            type="button"
            className="btn-secondary"
            onClick={carregarMaisAntigas}
            disabled={carregando}
          >
            {carregando ? 'Carregando…' : 'Ver mais antigas'}
          </button>
        ) : (
          <span className="muted">Início da conversa</span>
        )}
        {erro && <span className="error inline">{erro}</span>}
      </div>

      {mensagens.length === 0 ? (
        <div className="card">
          <p className="muted">Sem mensagens nesta conversa.</p>
        </div>
      ) : (
        <ol className="chat-list">
          {mensagens.map((m) => (
            <li
              key={m.id}
              className={`chat-msg ${m.role === 'USER' ? 'is-user' : 'is-assistant'}`}
            >
              <div className="chat-bubble">
                <div className="chat-texto">{m.texto}</div>
                <div className="chat-meta">{fmt.format(new Date(m.createdAt))}</div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
