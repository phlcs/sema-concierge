'use client'

import { useState } from 'react'
import { IconeEmail, IconeFechar, IconeReiniciar } from './Icones'

export default function Cabecalho({ nomeNegocio }: { nomeNegocio: string }) {
  const [painelAberto, setPainelAberto] = useState(false)

  return (
    <header className="top">
      <div className="top-inner">
        <div className="top-bar">
          <span className="logo">sema</span>
          <div className="spacer" />
          <button
            type="button"
            className="icon-btn"
            aria-label="Handoffs"
            aria-expanded={painelAberto}
            onClick={() => setPainelAberto((v) => !v)}
          >
            <IconeEmail />
          </button>
          {/* Reiniciar passa a funcionar quando houver conversa */}
          <button type="button" className="reset-btn" disabled>
            <IconeReiniciar />
            Reiniciar
          </button>
        </div>
        <div className="title-block">
          <div className="eyebrow">Ambiente de teste do assistente</div>
          <div className="business">{nomeNegocio}</div>
        </div>

        {painelAberto && (
          <div className="panel" role="dialog" aria-label="Handoffs">
            <div className="panel-head">
              <div className="panel-title">
                Handoffs <small>0</small>
              </div>
              <button
                type="button"
                className="close-btn"
                aria-label="Fechar"
                onClick={() => setPainelAberto(false)}
              >
                <IconeFechar />
              </button>
            </div>
            <div className="panel-empty">
              Nenhum handoff nesta sessão. Quando o assistente encaminhar o lead ao prestador, o
              email aparece aqui.
            </div>
          </div>
        )}
      </div>
    </header>
  )
}
