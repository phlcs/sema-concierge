import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { carregarDemo } from '@/lib/demo/acesso'
import { listarMensagensSessao } from '@/lib/demo/conversa'
import { COOKIE_SESSAO, sessaoValida } from '@/lib/demo/sessao'
import Cabecalho from './Cabecalho'
import Chat from './Chat'

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

  const store = await cookies()
  const sessaoId = sessaoValida(store.get(COOKIE_SESSAO)?.value)
  const mensagens = sessaoId ? await listarMensagensSessao(acesso.demo.id, sessaoId) : []

  return (
    <div className="screen">
      <Cabecalho nomeNegocio={nomeNegocio} />
      <main className="body">
        <Chat
          token={token}
          nomeNegocio={nomeNegocio}
          numeroExibicao={numeroExibicao}
          mensagensIniciais={mensagens}
        />
      </main>
    </div>
  )
}
