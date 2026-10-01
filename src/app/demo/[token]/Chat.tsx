'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { MensagemTela } from '@/lib/demo/conversa'
import type { CardHandoff } from '@/lib/demo/handoff'
import { IconeEnviar, IconeTicks, IconeVoltar } from './Icones'

const LIMITE_CARACTERES = 500

const formatoHora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  hour: '2-digit',
  minute: '2-digit',
})

function horaAgora(): string {
  return formatoHora.format(new Date())
}

export default function Chat(props: {
  token: string
  nomeNegocio: string
  numeroExibicao: string
  mensagensIniciais: MensagemTela[]
  onHandoff: (card: CardHandoff) => void
  onEnviando: (enviando: boolean) => void
}) {
  const { token, nomeNegocio, numeroExibicao, mensagensIniciais, onHandoff, onEnviando } = props
  const [mensagens, setMensagens] = useState<MensagemTela[]>(mensagensIniciais)
  const [rascunho, setRascunho] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const fimRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fimRef.current?.scrollIntoView({ block: 'end' })
  }, [mensagens, enviando, erro])

  const inicial = nomeNegocio.trim().charAt(0).toUpperCase() || 'S'

  async function enviar(e: FormEvent) {
    e.preventDefault()
    const texto = rascunho.trim()
    if (!texto || enviando) return

    setErro(null)
    setEnviando(true)
    onEnviando(true)
    setRascunho('')
    const anteriores = mensagens
    setMensagens([...anteriores, { role: 'user', texto, hora: horaAgora() }])

    try {
      const res = await fetch(`/demo/${token}/mensagem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto }),
      })
      if (res.status === 404 || res.status === 410) {
        window.location.reload()
        return
      }
      if (!res.ok) throw new Error(`status ${res.status}`)
      const data = (await res.json()) as { texto?: string; handoff?: CardHandoff }
      if (typeof data.texto !== 'string') throw new Error('resposta sem texto')
      setMensagens((atual) => [...atual, { role: 'assistant', texto: data.texto!, hora: horaAgora() }])
      if (data.handoff) onHandoff(data.handoff)
    } catch {
      setMensagens(anteriores)
      setRascunho(texto)
      setErro('Não foi possível enviar. Tente de novo.')
    } finally {
      setEnviando(false)
      onEnviando(false)
      inputRef.current?.focus()
    }
  }

  return (
    <div className="chat">
      <div className="chat-head">
        <IconeVoltar />
        <div className="avatar" aria-hidden="true">
          {inicial}
        </div>
        <div className="chat-id">
          <div className="chat-name">{nomeNegocio}</div>
          <div className="chat-phone">{numeroExibicao}</div>
        </div>
        <div className="chat-status">{enviando ? 'digitando…' : 'online'}</div>
      </div>

      <div className="messages" aria-live="polite">
        <div className="notice">
          Ambiente de teste. A conversa roda com o cérebro do seu negócio e nada é enviado a
          clientes reais.
        </div>
        {mensagens.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'line user' : 'line'}>
            <div className="bubble">
              {m.texto}
              <span className="time">
                {m.hora}
                {m.role === 'user' && <IconeTicks />}
              </span>
              <span className="clear" />
            </div>
          </div>
        ))}
        {enviando && (
          <div className="line">
            <div className="typing" aria-label="Digitando">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
        {erro && <div className="erro">{erro}</div>}
        <div ref={fimRef} />
      </div>

      <form className="composer" onSubmit={enviar}>
        <input
          ref={inputRef}
          className="input"
          type="text"
          placeholder="Mensagem"
          aria-label="Mensagem"
          maxLength={LIMITE_CARACTERES}
          value={rascunho}
          onChange={(e) => setRascunho(e.target.value)}
          disabled={enviando}
          autoComplete="off"
        />
        <button
          type="submit"
          className="send"
          aria-label="Enviar"
          disabled={enviando || !rascunho.trim()}
        >
          <IconeEnviar />
        </button>
      </form>
    </div>
  )
}
