'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import BookingModal from '@/components/BookingModal'

/* ----------------------------------------------------------------
   Types
   ---------------------------------------------------------------- */
export type ConversationSummary = {
  id: string
  title: string
  updatedAt: number
  preview: string
}

type AiStep = { title: string; description: string }

type AssistantContent = {
  paragraphs: string[]
  checklist: string[] | null
  steps: AiStep[] | null
  suggestBook: boolean
  bookReason: string | null
}

type UserMessage = { id: string; role: 'USER'; text: string }
type AssistantMessage = { id: string; role: 'ASSISTANT'; content: AssistantContent }
type LoadingMessage = { id: 'loading'; role: 'ASSISTANT'; loading: true }
type UIMessage = UserMessage | AssistantMessage | LoadingMessage

type User = { id: string; name: string; email: string }

const STARTERS = [
  'Tenho MEI, recebo como PF também e faço uns freelas por fora. Por onde começo?',
  'Investi em FIIs e CDB pela primeira vez. Preciso declarar?',
  'Acho que caí na malha fina. O que devo fazer agora?',
  'Tenho uma holding familiar. Como declaro os bens corretamente?',
]

/* ----------------------------------------------------------------
   Helpers
   ---------------------------------------------------------------- */
function fmtDate(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'Agora'
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + 'min'
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + 'h'
  if (diff < 172_800_000) return 'Ontem'
  return new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

function renderInline(text: string, keyBase: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('**'))
      parts.push(<strong key={`${keyBase}-b${i}`}>{tok.slice(2, -2)}</strong>)
    else
      parts.push(
        <span key={`${keyBase}-t${i}`} className="chat-term">
          {tok.slice(1, -1)}
        </span>
      )
    last = m.index + tok.length
    i++
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

/* ----------------------------------------------------------------
   Icons
   ---------------------------------------------------------------- */
function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}
function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M3 12h18M3 6h18M3 18h18" />
    </svg>
  )
}
function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}
function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  )
}
function EmptyChatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}
function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  )
}

/* ----------------------------------------------------------------
   AssistantBubble — renders structured AI response
   ---------------------------------------------------------------- */
function AssistantBubble({
  content,
  onBook,
}: {
  content: AssistantContent
  onBook: (context: string | null) => void
}) {
  return (
    <>
      <div className="chat-bubble">
        {content.paragraphs.map((p, i) => (
          <p key={i}>{renderInline(p, `p${i}`)}</p>
        ))}

        {content.checklist && content.checklist.length > 0 && (
          <ul className="chat-checklist">
            {content.checklist.map((item, i) => (
              <li key={i}>{renderInline(item, `c${i}`)}</li>
            ))}
          </ul>
        )}

        {content.steps && content.steps.length > 0 && (
          <div className="chat-steps">
            {content.steps.map((step, i) => (
              <div key={i} className="chat-step">
                <div className="chat-step-num">{i + 1}</div>
                <div className="chat-step-body">
                  <div className="chat-step-title">{renderInline(step.title, `st${i}`)}</div>
                  <div className="chat-step-desc">{renderInline(step.description, `sd${i}`)}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="chat-disclaimer">
          <InfoIcon />
          <span>
            Orientação, não aconselhamento contábil formal. Para o seu caso específico, uma sessão
            com o Rafael garante a resposta certa.
          </span>
        </div>
      </div>

      {content.suggestBook && (
        <div className="chat-book-card">
          <div className="chat-book-avatar">R</div>
          <div className="chat-book-body">
            <div className="chat-book-eyebrow">Falar com um especialista</div>
            <div className="chat-book-reason">
              {content.bookReason || 'Quer que o Rafael revise isso com você?'}
            </div>
            <div className="chat-book-price">
              Sessão de 1h com contador real · <strong>R$ 197</strong>
            </div>
          </div>
          <button
            className="chat-book-cta"
            onClick={() => onBook(content.bookReason ?? null)}
          >
            Agendar sessão →
          </button>
        </div>
      )}
    </>
  )
}

/* ----------------------------------------------------------------
   Main component
   ---------------------------------------------------------------- */
export default function ChatPage({
  user,
  initialConversations,
  autoBook = false,
}: {
  user: User
  initialConversations: ConversationSummary[]
  autoBook?: boolean
}) {
  const router = useRouter()

  const [conversations, setConversations] = useState<ConversationSummary[]>(initialConversations)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  // undefined = closed, null | string = open (null means no context)
  const [bookingContext, setBookingContext] = useState<string | null | undefined>(
    autoBook ? null : undefined
  )

  const scrollRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const firstName = user.name.split(/\s+/)[0]
  const initials = user.name
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  // Focus textarea when conversation changes
  useEffect(() => {
    setTimeout(() => taRef.current?.focus(), 80)
  }, [activeId])

  const autoGrow = () => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }

  /* ---- Select conversation ---- */
  const selectConvo = useCallback(
    async (id: string) => {
      if (id === activeId) {
        setSidebarOpen(false)
        return
      }
      setActiveId(id)
      setSidebarOpen(false)
      setLoadingMessages(true)
      setMessages([])

      try {
        const res = await fetch(`/api/conversations/${id}/messages`)
        if (!res.ok) throw new Error()
        const data: Array<{ id: string; role: string; content: unknown }> = await res.json()
        const msgs: UIMessage[] = data.map((m) => {
          if (m.role === 'USER') {
            const c = m.content as { text?: string }
            return { id: m.id, role: 'USER' as const, text: c.text ?? '' }
          }
          return { id: m.id, role: 'ASSISTANT' as const, content: m.content as AssistantContent }
        })
        setMessages(msgs)
      } catch {
        setMessages([])
      } finally {
        setLoadingMessages(false)
      }
    },
    [activeId]
  )

  /* ---- New conversation ---- */
  const newConvo = useCallback(() => {
    setActiveId(null)
    setMessages([])
    setSidebarOpen(false)
    setInput('')
    setTimeout(() => taRef.current?.focus(), 80)
  }, [])

  /* ---- Delete conversation ---- */
  const deleteConvo = useCallback(
    async (id: string) => {
      setDeleteConfirmId(null)
      await fetch(`/api/conversations/${id}`, { method: 'DELETE' })
      setConversations((prev) => prev.filter((c) => c.id !== id))
      if (activeId === id) {
        setActiveId(null)
        setMessages([])
      }
    },
    [activeId]
  )

  /* ---- Send message ---- */
  const send = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? input).trim()
      if (!text || busy) return

      setInput('')
      if (taRef.current) taRef.current.style.height = 'auto'
      setBusy(true)

      // Optimistic UI
      setMessages((prev) => [
        ...prev,
        { id: 'opt-user', role: 'USER' as const, text },
        { id: 'loading', role: 'ASSISTANT' as const, loading: true as const },
      ])

      try {
        const res = await fetch('/api/chat/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId: activeId, message: text }),
        })

        if (res.status === 429) {
          const err = await res.json().catch(() => ({}))
          const reason = err?.reason as string | undefined
          const retryAfter = err?.retryAfterSeconds as number | undefined

          let paragraphs: string[]
          let suggestBook = false
          let bookReason: string | null = null

          if (reason === 'user_daily') {
            paragraphs = [
              'Você atingiu o limite de 5 perguntas por dia. Volta amanhã, ou agende uma sessão com o Rafael pra tirar todas as dúvidas de uma vez.',
            ]
            suggestBook = true
            bookReason = 'Sessão 1:1 com o contador Rafael pra resolver tudo de uma vez.'
          } else if (reason === 'global_daily') {
            paragraphs = [
              'O assistente atingiu o limite diário de uso geral. Tenta de novo amanhã, ou agende uma sessão direta com o Rafael.',
            ]
            suggestBook = true
            bookReason = 'Atendimento direto com o contador Rafael.'
          } else {
            paragraphs = [
              `Calma! Aguarde ${retryAfter ?? 8} segundo${(retryAfter ?? 8) === 1 ? '' : 's'} antes de enviar outra mensagem.`,
            ]
          }

          setMessages((prev) => [
            ...prev.filter((m) => m.id !== 'loading' && m.id !== 'opt-user'),
            { id: 'opt-user', role: 'USER' as const, text },
            {
              id: 'err',
              role: 'ASSISTANT' as const,
              content: { paragraphs, checklist: null, steps: null, suggestBook, bookReason },
            },
          ])
          return
        }

        if (!res.ok) throw new Error()
        const data = await res.json()

        setActiveId(data.conversationId)

        setMessages((prev) => [
          ...prev.filter((m) => m.id !== 'loading' && m.id !== 'opt-user'),
          { id: data.userMessageId, role: 'USER' as const, text },
          { id: data.assistantMessageId, role: 'ASSISTANT' as const, content: data.response },
        ])

        // Update sidebar list
        const title = text.slice(0, 40) + (text.length > 40 ? '…' : '')
        setConversations((prev) => {
          const exists = prev.find((c) => c.id === data.conversationId)
          if (exists) {
            return [
              {
                ...exists,
                title: exists.title === 'Nova conversa' ? title : exists.title,
                updatedAt: Date.now(),
                preview: text.slice(0, 60),
              },
              ...prev.filter((c) => c.id !== data.conversationId),
            ]
          }
          return [
            { id: data.conversationId, title, updatedAt: Date.now(), preview: text.slice(0, 60) },
            ...prev,
          ]
        })
      } catch {
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== 'loading' && m.id !== 'opt-user'),
          { id: 'opt-user', role: 'USER' as const, text },
          {
            id: 'err',
            role: 'ASSISTANT' as const,
            content: {
              paragraphs: [
                'Opa, tive um problema aqui. Tente de novo em alguns segundos — ou fale direto com um especialista.',
              ],
              checklist: null,
              steps: null,
              suggestBook: false,
              bookReason: null,
            },
          },
        ])
      } finally {
        setBusy(false)
      }
    },
    [input, busy, activeId]
  )

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/')
    router.refresh()
  }

  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)

  /* ----------------------------------------------------------------
     Render
     ---------------------------------------------------------------- */
  return (
    <div className="chat-app">
      {/* Booking modal */}
      {bookingContext !== undefined && (
        <BookingModal
          user={user}
          context={bookingContext}
          onClose={() => setBookingContext(undefined)}
        />
      )}

      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div className="chat-sb-backdrop" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ---- Sidebar ---- */}
      <aside className={`chat-sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="chat-sb-head">
          <span className="chat-sb-title">Conversas</span>
          <button className="chat-sb-new" onClick={newConvo} title="Nova conversa">
            <PlusIcon />
          </button>
        </div>

        <div className="chat-sb-list">
          {sorted.length === 0 ? (
            <div className="chat-sb-empty">
              <EmptyChatIcon />
              <span>Nenhuma conversa ainda.</span>
              <span>Comece perguntando algo!</span>
            </div>
          ) : (
            sorted.map((c) => (
              <div
                key={c.id}
                className={`chat-sb-item${c.id === activeId ? ' active' : ''}`}
              >
                <button className="chat-sb-item-btn" onClick={() => selectConvo(c.id)}>
                  <div className="chat-sb-item-title">{c.title}</div>
                  <div className="chat-sb-item-date">{fmtDate(c.updatedAt)}</div>
                </button>

                {deleteConfirmId === c.id ? (
                  <div className="chat-sb-del-confirm">
                    <button
                      className="chat-sb-del-yes"
                      onClick={() => deleteConvo(c.id)}
                    >
                      Apagar
                    </button>
                    <button
                      className="chat-sb-del-no"
                      onClick={() => setDeleteConfirmId(null)}
                    >
                      Não
                    </button>
                  </div>
                ) : (
                  <button
                    className="chat-sb-item-del"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleteConfirmId(c.id)
                    }}
                    title="Apagar conversa"
                  >
                    <TrashIcon />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </aside>

      {/* ---- Main area ---- */}
      <div className="chat-main">
        {/* Topbar */}
        <header className="chat-topbar">
          <div className="chat-topbar-left">
            <button
              className="chat-sb-toggle"
              onClick={() => setSidebarOpen((p) => !p)}
              aria-label="Abrir histórico"
            >
              <MenuIcon />
            </button>
            <a href="/" className="chat-brand" title="Voltar ao site">
              <div className="chat-brand-icon">?</div>
              <div className="chat-brand-text">
                <span className="chat-brand-pre">Pergunte ao seu</span>
                <strong>Contador</strong>
              </div>
            </a>
          </div>

          <div className="chat-topbar-right">
            <div className="chat-assistant-tag">
              <span className="chat-live-dot" />
              Assistente de contabilidade · online
            </div>
            <button
              className="chat-book-header-btn"
              onClick={() => setBookingContext(null)}
            >
              Agendar sessão
            </button>
            <Link href="/app/bookings" className="chat-nav-link">
              Agendamentos
            </Link>
            <div className="chat-topbar-div" />
            <div className="chat-user-chip">
              <div className="chat-user-av">{initials}</div>
              <div className="chat-user-meta">
                <span className="chat-user-name">{user.name}</span>
                <span className="chat-user-state">Conectado</span>
              </div>
            </div>
            <button className="chat-logout-btn" onClick={handleLogout}>
              Sair
            </button>
          </div>
        </header>

        {/* Messages scroll area */}
        <div className="chat-scroll" ref={scrollRef}>
          <div className="chat-column">
            {loadingMessages ? (
              <div className="chat-loading-msgs">
                <div className="chat-dots">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            ) : messages.length === 0 ? (
              /* ---- Empty / ready state ---- */
              <div className="chat-ready">
                <div className="chat-ready-head">
                  Oi, {firstName} — sobre o que é a sua dúvida?
                </div>
                <p className="chat-ready-sub">
                  Escolha uma sugestão ou escreva sua pergunta no campo abaixo.
                </p>
                <div className="chat-starters-label">Comece por uma destas</div>
                <div className="chat-starters">
                  {STARTERS.map((s, i) => (
                    <button key={i} className="chat-starter" onClick={() => send(s)}>
                      <span className="chat-starter-qmark">?</span>
                      <span>{s}</span>
                      <span className="chat-starter-arrow">→</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              /* ---- Thread ---- */
              <div className="chat-thread">
                {messages.map((m) => {
                  if (m.role === 'USER') {
                    return (
                      <div key={m.id} className="chat-msg chat-msg-user">
                        <div className="chat-msg-avatar">{initials}</div>
                        <div className="chat-msg-body">
                          <div className="chat-msg-who">Você</div>
                          <div className="chat-bubble chat-bubble-user">{m.text}</div>
                        </div>
                      </div>
                    )
                  }

                  if ('loading' in m && m.loading) {
                    return (
                      <div key="loading" className="chat-msg chat-msg-assistant">
                        <div className="chat-msg-avatar chat-msg-avatar-bot">?</div>
                        <div className="chat-msg-body">
                          <div className="chat-msg-who">Assistente de contabilidade</div>
                          <div className="chat-bubble">
                            <div className="chat-dots">
                              <span />
                              <span />
                              <span />
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  }

                  const assistantMsg = m as AssistantMessage
                  return (
                    <div key={assistantMsg.id} className="chat-msg chat-msg-assistant">
                      <div className="chat-msg-avatar chat-msg-avatar-bot">?</div>
                      <div className="chat-msg-body">
                        <div className="chat-msg-who">Assistente de contabilidade</div>
                        <AssistantBubble
                          content={assistantMsg.content}
                          onBook={(ctx) => setBookingContext(ctx)}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Composer */}
        <div className="chat-composer-wrap">
          <div className="chat-composer">
            <div className="chat-composer-box">
              <textarea
                ref={taRef}
                value={input}
                rows={1}
                placeholder="Diga como podemos te ajudar…"
                onChange={(e) => {
                  setInput(e.target.value)
                  autoGrow()
                }}
                onKeyDown={handleKey}
                disabled={busy}
              />
              <button
                className="chat-send"
                disabled={!input.trim() || busy}
                onClick={() => send()}
                aria-label="Enviar"
              >
                <SendIcon />
              </button>
            </div>
            <div className="chat-composer-foot">
              <span>
                IA pode errar. Para decisões importantes, agende uma sessão com o Rafael.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
