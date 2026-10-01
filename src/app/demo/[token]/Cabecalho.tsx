'use client'

import type { CardHandoff } from '@/lib/demo/handoff'
import { IconeEmail, IconeFechar, IconeReiniciar } from './Icones'

export default function Cabecalho(props: {
  nomeNegocio: string
  handoff: CardHandoff | null
  naoLido: boolean
  painelAberto: boolean
  toastVisivel: boolean
  reiniciarDesativado: boolean
  onAlternarPainel: () => void
  onFecharPainel: () => void
  onAbrirPeloToast: () => void
  onReiniciar: () => void
}) {
  const { nomeNegocio, handoff, naoLido, painelAberto, toastVisivel } = props
  const total = handoff ? 1 : 0

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
            onClick={props.onAlternarPainel}
          >
            <IconeEmail />
            {naoLido && total > 0 && <span className="badge">{total}</span>}
          </button>
          <button
            type="button"
            className="reset-btn"
            onClick={props.onReiniciar}
            disabled={props.reiniciarDesativado}
          >
            <IconeReiniciar />
            Reiniciar
          </button>
        </div>
        <div className="title-block">
          <div className="eyebrow">Ambiente de teste do assistente</div>
          <div className="business">{nomeNegocio}</div>
        </div>

        {toastVisivel && !painelAberto && (
          <button type="button" className="toast" onClick={props.onAbrirPeloToast}>
            <IconeEmail size={18} />
            <span className="msg">Novo handoff enviado ao prestador</span>
            <span className="open">Abrir</span>
          </button>
        )}

        {painelAberto && (
          <div className="panel" role="dialog" aria-label="Handoffs">
            <div className="panel-head">
              <div className="panel-title">
                Handoffs <small>{total}</small>
              </div>
              <button
                type="button"
                className="close-btn"
                aria-label="Fechar"
                onClick={props.onFecharPainel}
              >
                <IconeFechar />
              </button>
            </div>
            {handoff ? (
              <div className="mail-wrap">
                <div className="mail">
                  <div className="mail-brand">Sema</div>
                  <div className="mail-title">Novo lead</div>
                  <div className="mail-meta">
                    Para: {handoff.para}
                    <br />
                    Assunto: {handoff.assunto}
                  </div>
                  <div className="row">
                    <div className="row-label">Nome</div>
                    <div className="row-value main">{handoff.nome}</div>
                  </div>
                  <div className="row">
                    <div className="row-label">Contato</div>
                    <div className="row-value">{handoff.contato}</div>
                  </div>
                  <div className="row">
                    <div className="row-label">O que quer</div>
                    <div className="row-value">{handoff.intencao}</div>
                  </div>
                  <div className="row">
                    <div className="row-label">Resumo</div>
                    <div className="row-value">{handoff.resumo}</div>
                  </div>
                  <div className="row">
                    <div className="row-label">Quando</div>
                    <div className="row-value">{handoff.quando}</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="panel-empty">
                Nenhum handoff nesta sessão. Quando o assistente encaminhar o lead ao prestador, o
                email aparece aqui.
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  )
}
