import { notFound } from 'next/navigation'
import { carregarDemo } from '@/lib/demo/acesso'
import Cabecalho from './Cabecalho'
import { IconeEnviar, IconeVoltar } from './Icones'

export const dynamic = 'force-dynamic'

export default async function DemoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const acesso = await carregarDemo(token)

  if (acesso.estado === 'inexistente') notFound()

  const { nomeNegocio, numeroExibicao } = acesso.demo

  if (acesso.estado === 'encerrada') {
    return (
      <div className="screen">
        <header className="top">
          <div className="top-inner">
            <div className="top-bar">
              <span className="logo">sema</span>
            </div>
            <div className="title-block">
              <div className="eyebrow">Ambiente de teste do assistente</div>
              <div className="business">{nomeNegocio}</div>
            </div>
          </div>
        </header>
        <div className="ended">
          <div>
            <h2>Demonstração encerrada</h2>
            <p>O período de teste deste link terminou. Fale com a Sema para continuar.</p>
          </div>
        </div>
      </div>
    )
  }

  const inicial = nomeNegocio.trim().charAt(0).toUpperCase() || 'S'

  return (
    <div className="screen">
      <Cabecalho nomeNegocio={nomeNegocio} />
      <main className="body">
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
            <div className="chat-status">online</div>
          </div>
          <div className="messages">
            <div className="notice">
              Ambiente de teste. A conversa roda com o cérebro do seu negócio e nada é enviado a
              clientes reais.
            </div>
          </div>
          <div className="composer">
            <input
              className="input"
              type="text"
              placeholder="Mensagem"
              aria-label="Mensagem"
              maxLength={500}
              disabled
            />
            <button type="button" className="send" aria-label="Enviar" disabled>
              <IconeEnviar />
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
