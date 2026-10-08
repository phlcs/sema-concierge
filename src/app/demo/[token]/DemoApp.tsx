'use client'

import { useEffect, useState } from 'react'
import type { MensagemTela } from '@/lib/demo/conversa'
import type { CardHandoff } from '@/lib/demo/handoff'
import Cabecalho from './Cabecalho'
import Chat from './Chat'

const DURACAO_TOAST_MS = 6000

export default function DemoApp(props: {
  token: string
  nomeNegocio: string
  numeroExibicao: string
  mensagensIniciais: MensagemTela[]
  handoffInicial: CardHandoff | null
}) {
  const { token, nomeNegocio, numeroExibicao } = props
  const [sessao, setSessao] = useState(0)
  const [mensagensIniciais, setMensagensIniciais] = useState(props.mensagensIniciais)
  const [handoff, setHandoff] = useState<CardHandoff | null>(props.handoffInicial)
  const [naoLido, setNaoLido] = useState(false)
  const [painelAberto, setPainelAberto] = useState(false)
  const [toastVisivel, setToastVisivel] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [reiniciando, setReiniciando] = useState(false)
  const [erroReinicio, setErroReinicio] = useState<string | null>(null)

  useEffect(() => {
    if (!toastVisivel) return
    const t = setTimeout(() => setToastVisivel(false), DURACAO_TOAST_MS)
    return () => clearTimeout(t)
  }, [toastVisivel])

  function receberHandoff(card: CardHandoff) {
    setHandoff(card)
    setNaoLido(true)
    setToastVisivel(true)
  }

  function abrirPainel() {
    setPainelAberto(true)
    setNaoLido(false)
    setToastVisivel(false)
  }

  async function reiniciar() {
    setReiniciando(true)
    setErroReinicio(null)
    try {
      const res = await fetch(`/demo/${token}/reiniciar`, { method: 'POST' })
      if (res.status === 404 || res.status === 410) {
        window.location.reload()
        return
      }
      if (!res.ok) throw new Error(`status ${res.status}`)
      setHandoff(null)
      setNaoLido(false)
      setToastVisivel(false)
      setPainelAberto(false)
      setMensagensIniciais([])
      setSessao((n) => n + 1)
      setConfirmando(false)
    } catch {
      setErroReinicio('Não foi possível reiniciar. Tente de novo.')
    } finally {
      setReiniciando(false)
    }
  }

  return (
    <div className="screen">
      <Cabecalho
        nomeNegocio={nomeNegocio}
        handoff={handoff}
        naoLido={naoLido}
        painelAberto={painelAberto}
        toastVisivel={toastVisivel}
        reiniciarDesativado={enviando}
        onAlternarPainel={() => (painelAberto ? setPainelAberto(false) : abrirPainel())}
        onFecharPainel={() => setPainelAberto(false)}
        onAbrirPeloToast={abrirPainel}
        onReiniciar={() => {
          setErroReinicio(null)
          setConfirmando(true)
        }}
      />
      <main className="body">
        <Chat
          key={sessao}
          token={token}
          nomeNegocio={nomeNegocio}
          numeroExibicao={numeroExibicao}
          mensagensIniciais={mensagensIniciais}
          onHandoff={receberHandoff}
          onEnviando={setEnviando}
        />
      </main>

      {confirmando && (
        <div className="backdrop">
          <div
            className="dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="dialog-reiniciar-titulo"
          >
            <div className="dialog-title" id="dialog-reiniciar-titulo">
              Reiniciar atendimento?
            </div>
            <div className="dialog-body">
              A conversa e todos os handoffs desta sessão serão apagados. Você começa um novo
              atendimento do zero.
            </div>
            {erroReinicio && <div className="dialog-erro">{erroReinicio}</div>}
            <div className="dialog-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setConfirmando(false)}
                disabled={reiniciando}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={reiniciar}
                disabled={reiniciando}
              >
                Reiniciar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
