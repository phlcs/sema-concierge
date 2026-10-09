'use client'

import { useRef, useState } from 'react'
import { IconePausa, IconePlay } from './Icones'

// Alturas fixas das barras (só visual, não é a onda real do áudio)
const BARRAS = Array.from({ length: 30 }, (_, i) => 22 + ((i * 53 + 17) % 11) * 7)

function formatar(s: number): string {
  const inteiro = Math.max(0, Math.round(s))
  return `${Math.floor(inteiro / 60)}:${String(inteiro % 60).padStart(2, '0')}`
}

// Bolha de áudio estilo WhatsApp. `url` é a gravação feita neste navegador; depois de
// recarregar a página ela não existe mais (o áudio nunca é guardado), e o play fica
// desligado. `transcricao` vazia = ainda transcrevendo.
export default function AudioBolha(props: {
  url: string | null
  seg: number | null
  transcricao: string
}) {
  const { url, seg, transcricao } = props
  const audioRef = useRef<HTMLAudioElement>(null)
  const [tocando, setTocando] = useState(false)
  const [atual, setAtual] = useState(0)

  const progresso = seg ? Math.min(1, atual / seg) : 0
  const barrasFeitas = Math.round(progresso * BARRAS.length)

  function alternar() {
    const el = audioRef.current
    if (!el) return
    if (el.paused) void el.play().catch(() => setTocando(false))
    else el.pause()
  }

  return (
    <div className="audio-bolha">
      <div className="audio-linha">
        <button
          type="button"
          className="audio-play"
          aria-label={tocando ? 'Pausar áudio' : 'Tocar áudio'}
          disabled={!url}
          onClick={alternar}
        >
          {tocando ? <IconePausa size={16} /> : <IconePlay size={16} />}
        </button>
        <div className="audio-barras" aria-hidden="true">
          {BARRAS.map((h, i) => (
            <span key={i} className={i < barrasFeitas ? 'feita' : undefined} style={{ height: `${h}%` }} />
          ))}
        </div>
        <span className="audio-tempo">
          {seg == null ? 'Áudio' : formatar(tocando || atual > 0 ? atual : seg)}
        </span>
        {url && (
          <audio
            ref={audioRef}
            src={url}
            preload="auto"
            onPlay={() => setTocando(true)}
            onPause={() => setTocando(false)}
            onTimeUpdate={(e) => setAtual(e.currentTarget.currentTime)}
            onEnded={() => {
              setTocando(false)
              setAtual(0)
            }}
          />
        )}
      </div>
      <div className="audio-transcricao">
        <span>Transcrição</span>
        {transcricao || 'Transcrevendo…'}
      </div>
    </div>
  )
}
