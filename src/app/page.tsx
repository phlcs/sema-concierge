import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { verifyToken, COOKIE_NAME } from '@/lib/auth'
import NavAuthLink from '@/components/NavAuthLink'
import LandingFaq from '@/components/LandingFaq'
import ChatFab from '@/components/ChatFab'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://pergunteaoseucontador.com.br'

export const metadata: Metadata = {
  title: 'Pergunte ao seu Contador — Seu IR resolvido em 1 hora',
  description:
    'Sessão individual com um contador de verdade. Diagnóstico fiscal, orientação passo a passo e checklist personalizado. R$ 197, pagamento único, Google Meet.',
  openGraph: {
    title: 'Pergunte ao seu Contador — Seu IR resolvido em 1 hora',
    description:
      'Sessão individual com um contador de verdade. Diagnóstico fiscal, orientação passo a passo e checklist personalizado. R$ 197, pagamento único.',
    url: BASE_URL,
    siteName: 'Pergunte ao seu Contador',
    locale: 'pt_BR',
    type: 'website',
    // TODO: adicionar og:image quando houver uma imagem de compartilhamento
    // images: [{ url: `${BASE_URL}/og-image.png`, width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Pergunte ao seu Contador — Seu IR resolvido em 1 hora',
    description:
      'Sessão individual com um contador de verdade. Diagnóstico fiscal, orientação passo a passo e checklist personalizado.',
    // TODO: adicionar twitter:image quando houver uma imagem de compartilhamento
  },
  alternates: { canonical: BASE_URL },
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default async function LandingPage() {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  const isLoggedIn = token ? verifyToken(token) !== null : false
  const bookingHref = isLoggedIn ? '/app/chat?action=book' : '/login?next=/app/chat&action=book'

  return (
    <div className="landing">
      {/* NAV */}
      <nav>
        <div className="container">
          <a href="#topo" className="nav-logo">
            <div className="nav-icon">?</div>
            <div className="nav-brand">
              <span className="nav-pre">Pergunte ao seu</span>
              <strong>Contador</strong>
            </div>
          </a>
          <div className="nav-actions">
            <NavAuthLink />
            <a href={bookingHref} className="btn btn-primary">
              Agendar sessão
            </a>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="hero" id="topo">
        <div className="container">
          <div className="hero-content">
            <div className="hero-badge fade-up">
              <span className="dot" /> Vagas limitadas — período do IR
            </div>
            <h1 className="fade-up fade-up-d1">
              Seu IR resolvido
              <br />
              em <span>1 hora.</span>
            </h1>
            <p className="hero-lede fade-up fade-up-d2">
              Uma sessão individual com um contador de verdade. Você chega com dúvidas, sai
              sabendo exatamente o que fazer. Sem mensalidade, sem enrolação.
            </p>
            <div className="hero-ctas fade-up fade-up-d3">
              <a href={bookingHref} className="btn btn-primary">
                Quero resolver meu IR →
              </a>
            </div>
            <a href="#como-funciona" className="hero-how-link fade-up fade-up-d4">
              Como funciona ↓
            </a>
          </div>
          <div className="hero-visual fade-up fade-up-d4">
            <div className="hero-card">
              <div className="hero-card-header">
                <div className="hero-card-avatar">R</div>
                <div>
                  <div className="hero-card-name">Rafael</div>
                  <div className="hero-card-role">Contador · CRC ativo</div>
                </div>
              </div>
              <div className="hero-card-items">
                <div className="hero-card-item">
                  <div className="hero-card-check">
                    <CheckIcon />
                  </div>
                  Diagnóstico da sua situação fiscal
                </div>
                <div className="hero-card-item">
                  <div className="hero-card-check">
                    <CheckIcon />
                  </div>
                  Orientação passo a passo
                </div>
                <div className="hero-card-item">
                  <div className="hero-card-check">
                    <CheckIcon />
                  </div>
                  Checklist personalizado por escrito
                </div>
                <div className="hero-card-item">
                  <div className="hero-card-check">
                    <CheckIcon />
                  </div>
                  Tira-dúvidas sem julgamento
                </div>
              </div>
              <div className="hero-card-price">
                <span className="currency">R$</span>
                <span className="amount">197</span>
                <span className="desc">sessão única</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="how" id="como-funciona">
        <div className="container">
          <div className="section-label">Como funciona</div>
          <h2 className="section-title">Três passos. Uma hora. IR resolvido.</h2>
          <div className="steps">
            <div className="step">
              <div className="step-number">1</div>
              <h3>Agende sua sessão</h3>
              <p>
                Escolha o melhor horário e faça o pagamento. Você recebe a confirmação e um link
                do Google Meet na hora.
              </p>
            </div>
            <div className="step">
              <div className="step-number">2</div>
              <h3>Sessão com o Rafael</h3>
              <p>
                Em 1 hora, ele analisa sua situação, tira todas as dúvidas e te explica
                exatamente como preencher e enviar sua declaração.
              </p>
            </div>
            <div className="step">
              <div className="step-number">3</div>
              <h3>Receba seu checklist</h3>
              <p>
                Após a sessão, você recebe um resumo por escrito com tudo que precisa fazer. É
                só seguir o passo a passo e enviar.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* FOR WHO */}
      <section className="for-who">
        <div className="container">
          <div className="section-label">Pra quem é</div>
          <h2 className="section-title">Se você se identifica, essa sessão é pra você.</h2>
          <div className="profiles">
            <div className="profile-card clt">
              <span className="profile-emoji" role="img" aria-label="pessoa no computador">
                💻
              </span>
              <h3>CLT que começou a investir</h3>
              <p className="quote">
                "Eu sei que tenho que declarar os investimentos, mas não sei se estou fazendo
                certo..."
              </p>
              <ul>
                <li>Tem CDB, Tesouro, FII ou ações</li>
                <li>Nunca precisou de contador até agora</li>
                <li>Medo de cair na malha fina</li>
                <li>Não sabe a diferença entre isento e tributável</li>
              </ul>
            </div>
            <div className="profile-card freelancer">
              <span className="profile-emoji" role="img" aria-label="pessoa criativa">
                🎨
              </span>
              <h3>Freelancer / MEI / PJ</h3>
              <p className="quote">
                "Eu tenho MEI, recebo como PF também, faço uns freelas por fora... tá tudo
                bagunçado."
              </p>
              <ul>
                <li>Mistura conta PF e PJ</li>
                <li>Recebe por Pix, NF e &quot;por fora&quot;</li>
                <li>Não sabe calcular o que é tributável</li>
                <li>Não quer contador mensal, só resolver agora</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* WHAT'S INCLUDED */}
      <section className="included">
        <div className="container">
          <div className="section-label">O que está incluso</div>
          <h2 className="section-title">Tudo que você precisa numa única sessão.</h2>
          <div className="included-grid">
            <div className="included-item">
              <div className="included-icon">🔍</div>
              <div>
                <h4>Diagnóstico fiscal completo</h4>
                <p>
                  Rafael analisa sua situação: investimentos, freelas, MEI, herança, imóvel — o
                  que for.
                </p>
              </div>
            </div>
            <div className="included-item">
              <div className="included-icon">📋</div>
              <div>
                <h4>Orientação passo a passo</h4>
                <p>
                  Explicação clara de como preencher sua declaração, o que declarar e o que é
                  isento.
                </p>
              </div>
            </div>
            <div className="included-item">
              <div className="included-icon">✅</div>
              <div>
                <h4>Checklist personalizado</h4>
                <p>
                  Resumo por escrito de tudo que você precisa fazer após a sessão, enviado por
                  WhatsApp ou e-mail.
                </p>
              </div>
            </div>
            <div className="included-item">
              <div className="included-icon">💬</div>
              <div>
                <h4>Tira-dúvidas sem julgamento</h4>
                <p>
                  Aquela pergunta que você tem vergonha de fazer no Google, você faz ali,
                  tranquilo.
                </p>
              </div>
            </div>
          </div>
          <div className="not-included">
            <h4>O que não está incluso (transparência total)</h4>
            <ul>
              <li>Envio da declaração (você envia por conta própria)</li>
              <li>Contabilidade mensal ou recorrente</li>
              <li>Acompanhamento de malha fina</li>
            </ul>
          </div>
        </div>
      </section>

      {/* FAQ — Client Component (accordion precisa de estado) */}
      <LandingFaq />

      {/* CTA FINAL */}
      <section className="cta-section" id="agendar">
        <div className="container">
          <div className="section-label">Resolva agora</div>
          <h2 className="section-title">Chega de ansiedade com o IR.</h2>
          <p className="cta-sub">
            Em 1 hora com o Rafael, você sai sabendo exatamente o que fazer. Sem mensalidade,
            sem enrolação, sem julgamento.
          </p>
          <div className="cta-price">R$ 197</div>
          <div className="cta-price-note">Sessão única de 1 hora · Google Meet</div>
          <a href={bookingHref} className="btn btn-primary btn-lg">
            Agendar minha sessão →
          </a>
          <p className="cta-secure">Pagamento seguro · Pix ou cartão de crédito</p>
        </div>
      </section>

      {/* CONTACT */}
      <section className="contact">
        <div className="container">
          <p>Ficou com alguma dúvida antes de agendar?</p>
          <a href="mailto:contato@pergunteaoseucontador.com.br">
            contato@pergunteaoseucontador.com.br
          </a>
        </div>
      </section>

      {/* FOOTER */}
      <footer>
        <div className="container">
          <p>© 2025 Pergunte ao seu Contador. Todos os direitos reservados.</p>
        </div>
      </footer>

      {/* FAB — Assistente de IA */}
      <ChatFab isLoggedIn={isLoggedIn} />
    </div>
  )
}
