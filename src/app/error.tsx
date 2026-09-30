'use client'

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log to server monitoring in production (digest is safe to log)
    if (process.env.NODE_ENV === 'production') {
      console.error('[error-boundary]', error.digest ?? 'no-digest')
    }
  }, [error])

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 24px',
        fontFamily: 'var(--font-dm-sans, system-ui, sans-serif)',
        background: 'var(--color-brand-gray-light, #F4F6F8)',
        textAlign: 'center',
        gap: '20px',
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 16,
          background: 'var(--color-brand-blue, #1B5FA3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--font-fraunces, Georgia, serif)',
          fontWeight: 700,
          fontSize: 28,
          color: '#fff',
        }}
      >
        ?
      </div>
      <div>
        <p
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 2,
            textTransform: 'uppercase',
            color: 'var(--color-brand-blue, #1B5FA3)',
            margin: '0 0 12px',
          }}
        >
          Sema
        </p>
        <h1
          style={{
            fontFamily: 'var(--font-fraunces, Georgia, serif)',
            fontWeight: 700,
            fontSize: 'clamp(24px, 4vw, 36px)',
            color: 'var(--color-brand-dark, #1A2B3D)',
            margin: '0 0 12px',
            lineHeight: 1.2,
          }}
        >
          Algo deu errado.
        </h1>
        <p
          style={{
            fontSize: 15,
            color: 'var(--color-brand-gray, #6B7D8E)',
            maxWidth: 380,
            lineHeight: 1.6,
            margin: '0 auto 24px',
          }}
        >
          Aconteceu um erro inesperado. Não se preocupe — seus dados estão seguros.
          {error.digest && (
            <span style={{ display: 'block', marginTop: 8, fontSize: 12, opacity: 0.6 }}>
              Ref: {error.digest}
            </span>
          )}
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={reset}
            style={{
              padding: '12px 28px',
              borderRadius: 10,
              background: 'var(--color-brand-blue, #1B5FA3)',
              color: '#fff',
              fontWeight: 700,
              fontSize: 15,
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Tentar novamente
          </button>
          <a
            href="/"
            style={{
              padding: '12px 28px',
              borderRadius: 10,
              background: '#fff',
              color: 'var(--color-brand-blue, #1B5FA3)',
              fontWeight: 700,
              fontSize: 15,
              border: '1.5px solid var(--color-brand-blue, #1B5FA3)',
              textDecoration: 'none',
              fontFamily: 'inherit',
            }}
          >
            Voltar ao início
          </a>
        </div>
      </div>
    </div>
  )
}
