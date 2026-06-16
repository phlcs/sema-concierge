'use client'

import { useState, FormEvent, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

// ---- SVG icons ----
const MailIcon = () => (
  <svg className="lead-ico" viewBox="0 0 24 24">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3 7l9 6 9-6" />
  </svg>
)
const LockIcon = () => (
  <svg className="lead-ico" viewBox="0 0 24 24">
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
)
const UserIcon = () => (
  <svg className="lead-ico" viewBox="0 0 24 24">
    <circle cx="12" cy="8" r="4" />
    <path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" />
  </svg>
)
const ArrowIcon = () => (
  <svg viewBox="0 0 24 24">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
)
const BackIcon = () => (
  <svg viewBox="0 0 24 24">
    <path d="M19 12H5M11 18l-6-6 6-6" />
  </svg>
)
const CheckSm = () => (
  <svg viewBox="0 0 24 24">
    <path d="M5 13l4 4L19 7" />
  </svg>
)

// ---- Validation helpers ----
const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim())

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextUrl = searchParams.get('next') ?? '/app'
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [peek, setPeek] = useState(false)
  const [touched, setTouched] = useState(false)
  const [loading, setLoading] = useState(false)
  const [apiError, setApiError] = useState('')

  const isSignup = mode === 'signup'

  const emailErr = touched && !emailOk(email)
  const passErr = touched && pass.length < 8
  const nameErr = touched && isSignup && name.trim().length < 2
  const valid =
    emailOk(email) &&
    pass.length >= 8 &&
    (!isSignup || name.trim().length >= 2)

  const switchMode = (next: 'login' | 'signup') => {
    setMode(next)
    setTouched(false)
    setApiError('')
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (!valid) return

    setLoading(true)
    setApiError('')

    try {
      const endpoint = isSignup ? '/api/auth/signup' : '/api/auth/login'
      const body = isSignup
        ? { name: name.trim(), email: email.trim(), password: pass }
        : { email: email.trim(), password: pass }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await res.json()

      if (!res.ok) {
        setApiError(data.error ?? 'Algo deu errado. Tente novamente.')
        return
      }

      router.push(nextUrl)
      router.refresh()
    } catch {
      setApiError('Erro de conexão. Verifique sua internet e tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth">
      {/* ---- Left brand rail ---- */}
      <aside className="auth-rail">
        <div className="glow" aria-hidden="true" />
        <div className="auth-brand">
          <div className="ico">?</div>
          <div className="txt">
            <span className="pre">Pergunte ao seu</span>
            <span className="name">Contador</span>
          </div>
        </div>

        <div className="auth-pitch">
          <div className="eyebrow">Assistente de IA · grátis</div>
          <h2>Aquela dúvida de IR, respondida na hora.</h2>
          <p>
            Entre na sua conta pra conversar com o assistente — e ter suas respostas salvas pra
            consultar depois.
          </p>
          <ul className="auth-points">
            <li>
              <span className="pc">
                <CheckSm />
              </span>{' '}
              Respostas claras, sem jargão
            </li>
            <li>
              <span className="pc">
                <CheckSm />
              </span>{' '}
              Seu histórico fica salvo
            </li>
            <li>
              <span className="pc">
                <CheckSm />
              </span>{' '}
              Quando precisar, fale com o Rafael
            </li>
          </ul>
        </div>

        <div className="auth-rail-foot">
          <span className="av">R</span>
          Atendido por gente de verdade quando o caso pede.
        </div>
      </aside>

      {/* ---- Right form pane ---- */}
      <div className="auth-form-wrap">
        <div className="auth-top">
          <a href="/" className="auth-back">
            <BackIcon /> Voltar ao site
          </a>
        </div>

        <form className="auth-form" onSubmit={submit} noValidate>
          <div className="tag">
            <span className="live" />
            Assistente de contabilidade
          </div>
          <h1>{isSignup ? 'Crie sua conta grátis' : 'Entrar na sua conta'}</h1>
          <p className="lede">
            {isSignup
              ? 'Leva 10 segundos. Sem cartão, sem compromisso.'
              : 'Bem-vindo de volta. Continue de onde parou.'}
          </p>

          {apiError && <div className="auth-api-err">{apiError}</div>}

          {isSignup && (
            <div className={`auth-field${nameErr ? ' err' : ''}`}>
              <label htmlFor="name">Nome</label>
              <div className="auth-input-wrap">
                <UserIcon />
                <input
                  id="name"
                  type="text"
                  placeholder="Como podemos te chamar?"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                />
              </div>
              {nameErr && <div className="auth-err-msg">Conta pra gente seu nome.</div>}
            </div>
          )}

          <div className={`auth-field${emailErr ? ' err' : ''}`}>
            <label htmlFor="email">E-mail</label>
            <div className="auth-input-wrap">
              <MailIcon />
              <input
                id="email"
                type="email"
                placeholder="voce@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>
            {emailErr && <div className="auth-err-msg">Digite um e-mail válido.</div>}
          </div>

          <div className={`auth-field${passErr ? ' err' : ''}`}>
            <label htmlFor="password">Senha</label>
            <div className="auth-input-wrap">
              <LockIcon />
              <input
                id="password"
                type={peek ? 'text' : 'password'}
                placeholder={isSignup ? 'Crie uma senha (8+ caracteres)' : 'Sua senha'}
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                autoComplete={isSignup ? 'new-password' : 'current-password'}
              />
              <button type="button" className="auth-peek" onClick={() => setPeek((p) => !p)}>
                {peek ? 'Ocultar' : 'Mostrar'}
              </button>
            </div>
            {passErr && (
              <div className="auth-err-msg">A senha precisa de pelo menos 8 caracteres.</div>
            )}
          </div>

          {!isSignup && (
            <div className="auth-row">
              <label className="auth-remember">
                <input type="checkbox" defaultChecked /> Continuar conectado
              </label>
              <button type="button" className="auth-link">
                Esqueci a senha
              </button>
            </div>
          )}
          {isSignup && <div style={{ height: '6px' }} />}

          <button type="submit" className="auth-submit" disabled={loading || (touched && !valid)}>
            {loading
              ? 'Aguarde...'
              : isSignup
                ? 'Criar conta e conversar'
                : 'Entrar e conversar'}{' '}
            {!loading && <ArrowIcon />}
          </button>

          <div className="auth-switch">
            {isSignup ? 'Já tem conta? ' : 'Ainda não tem conta? '}
            <button type="button" onClick={() => switchMode(isSignup ? 'login' : 'signup')}>
              {isSignup ? 'Entrar' : 'Criar conta grátis'}
            </button>
          </div>

          <div className="auth-fineprint">
            Ao continuar, você concorda com os Termos e a Política de Privacidade. O assistente é
            uma IA e oferece orientação, não aconselhamento contábil formal.
          </div>
        </form>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
