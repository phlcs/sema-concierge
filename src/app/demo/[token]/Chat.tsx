'use client'

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react'
import type { MensagemTela } from '@/lib/demo/conversa'
import type { CardHandoff } from '@/lib/demo/handoff'
import { IconeEnviar, IconeLixeira, IconeMicrofone, IconeTicks, IconeVoltar } from './Icones'

const LIMITE_CARACTERES = 500
// Mesmo limite do WhatsApp: acima de 2min30 o servidor recusa
const LIMITE_GRAVACAO_S = 150
const TIPOS_GRAVACAO = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus']

const TXT_TRANSCREVENDO = '🎤 Transcrevendo…'
const TXT_SEM_TRANSCRICAO = '🎤 Áudio'

const semAssinatura = () => () => {}
// MediaRecorder e microfone: só no navegador, e só em HTTPS (ou localhost)
const temSuporteAudio = () =>
  typeof MediaRecorder !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function'

function formatarSegundos(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

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
  const suportaAudio = useSyncExternalStore(semAssinatura, temSuporteAudio, () => false)
  const [gravando, setGravando] = useState(false)
  const [segundos, setSegundos] = useState(0)
  const gravadorRef = useRef<MediaRecorder | null>(null)
  const descartarRef = useRef(false)

  // Sai da página gravando: solta o microfone sem enviar
  useEffect(
    () => () => {
      descartarRef.current = true
      if (gravadorRef.current?.state === 'recording') gravadorRef.current.stop()
    },
    [],
  )

  useEffect(() => {
    if (!gravando) return
    const t = setInterval(() => setSegundos((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [gravando])

  useEffect(() => {
    if (gravando && segundos >= LIMITE_GRAVACAO_S) pararGravacao(true)
  }, [segundos, gravando])

  useEffect(() => {
    fimRef.current?.scrollIntoView({ block: 'end' })
  }, [mensagens, enviando, erro])

  const inicial = nomeNegocio.trim().charAt(0).toUpperCase() || 'S'

  // Envio comum a texto e áudio. `bolha` é a mensagem otimista da pessoa; em caso de
  // falha a conversa volta ao que era e `restaurar` devolve o que ela tinha preparado.
  async function postar(args: {
    bolha: string
    init: RequestInit
    restaurar?: () => void
  }) {
    const { bolha, init, restaurar } = args
    const ehAudio = init.body instanceof FormData

    setErro(null)
    setEnviando(true)
    onEnviando(true)
    const anteriores = mensagens
    setMensagens([...anteriores, { role: 'user', texto: bolha, hora: horaAgora() }])

    try {
      const res = await fetch(`/demo/${token}/mensagem`, { method: 'POST', ...init })
      if (res.status === 404 || res.status === 410) {
        window.location.reload()
        return
      }
      if (!res.ok) throw new Error(`status ${res.status}`)
      const data = (await res.json()) as {
        texto?: string
        transcricao?: string
        handoff?: CardHandoff
      }
      if (typeof data.texto !== 'string') throw new Error('resposta sem texto')
      const resposta = { role: 'assistant' as const, texto: data.texto, hora: horaAgora() }
      setMensagens((atual) => {
        if (!ehAudio) return [...atual, resposta]
        // A bolha do áudio passa a mostrar o que foi entendido, para avaliar a transcrição
        const texto = data.transcricao ?? TXT_SEM_TRANSCRICAO
        return [...atual.map((m, i) => (i === anteriores.length ? { ...m, texto } : m)), resposta]
      })
      if (data.handoff) onHandoff(data.handoff)
    } catch {
      setMensagens(anteriores)
      restaurar?.()
      setErro('Não foi possível enviar. Tente de novo.')
    } finally {
      setEnviando(false)
      onEnviando(false)
      inputRef.current?.focus()
    }
  }

  async function enviar(e: FormEvent) {
    e.preventDefault()
    const texto = rascunho.trim()
    if (!texto || enviando) return
    setRascunho('')
    await postar({
      bolha: texto,
      init: {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto }),
      },
      restaurar: () => setRascunho(texto),
    })
  }

  async function iniciarGravacao() {
    if (enviando || gravando) return
    setErro(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = TIPOS_GRAVACAO.find((t) => MediaRecorder.isTypeSupported(t))
      const gravador = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      const pedacos: Blob[] = []
      descartarRef.current = false

      gravador.ondataavailable = (ev) => {
        if (ev.data.size > 0) pedacos.push(ev.data)
      }
      gravador.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        setGravando(false)
        if (descartarRef.current || pedacos.length === 0) return
        const blob = new Blob(pedacos, { type: gravador.mimeType || mimeType || 'audio/webm' })
        const form = new FormData()
        form.append('audio', blob, 'audio')
        void postar({ bolha: TXT_TRANSCREVENDO, init: { body: form } })
      }

      gravadorRef.current = gravador
      setSegundos(0)
      gravador.start()
      setGravando(true)
    } catch {
      setErro('Não foi possível usar o microfone. Libere a permissão no navegador e tente de novo.')
    }
  }

  function pararGravacao(enviarAudio: boolean) {
    descartarRef.current = !enviarAudio
    if (gravadorRef.current?.state === 'recording') gravadorRef.current.stop()
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

      {gravando ? (
        <div className="composer gravando">
          <button
            type="button"
            className="send cancelar"
            aria-label="Cancelar gravação"
            onClick={() => pararGravacao(false)}
          >
            <IconeLixeira />
          </button>
          <div className="rec-info" aria-live="off">
            <span className="rec-ponto" aria-hidden="true" />
            {formatarSegundos(segundos)}
          </div>
          <button
            type="button"
            className="send"
            aria-label="Enviar áudio"
            onClick={() => pararGravacao(true)}
          >
            <IconeEnviar />
          </button>
        </div>
      ) : (
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
          {suportaAudio && !rascunho.trim() ? (
            <button
              type="button"
              className="send"
              aria-label="Gravar áudio"
              disabled={enviando}
              onClick={iniciarGravacao}
            >
              <IconeMicrofone />
            </button>
          ) : (
            <button
              type="submit"
              className="send"
              aria-label="Enviar"
              disabled={enviando || !rascunho.trim()}
            >
              <IconeEnviar />
            </button>
          )}
        </form>
      )}
    </div>
  )
}
