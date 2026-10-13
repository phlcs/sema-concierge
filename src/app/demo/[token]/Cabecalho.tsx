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
            aria-label="Encaminhamentos"
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
            <span className="msg">{handoff ? `E-mail à equipe: ${handoff.titulo.toLowerCase()}` : ''}</span>
            <span className="open">Abrir</span>
          </button>
        )}

        {painelAberto && (
          <div className="panel" role="dialog" aria-label="Encaminhamentos">
            <div className="panel-head">
              <div className="panel-title">
                Encaminhamentos <small>{total}</small>
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
                  <div className="mail-brand">{nomeNegocio}</div>
                  <div className="mail-title">{handoff.titulo}</div>
                  <div className="mail-meta">
                    De: {handoff.remetente}
                    <br />
                    Para: {handoff.para}
                    <br />
                    Assunto: {handoff.assunto}
                  </div>
                  {handoff.destaque && (
                    <div className="mail-destaque">
                      <div className="row-label">{handoff.destaque.rotulo}</div>
                      {handoff.destaque.itens.map((item, i) => (
                        <div className="row-value main" key={i}>
                          {item}
                        </div>
                      ))}
                    </div>
                  )}
                  {handoff.linhas.map((l, i) => (
                    <div className="row" key={`${l.rotulo}-${i}`}>
                      <div className="row-label">{l.rotulo}</div>
                      <div className="row-value">{l.valor}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="panel-empty">
                Nenhum encaminhamento nesta sessão. Quando o assistente encaminhar um pedido para a
                equipe, o e-mail aparece aqui.
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  )
}
