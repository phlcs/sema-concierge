export default function NotFound() {
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
          Pergunte ao seu Contador
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
          Página não encontrada.
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
          O endereço que você acessou não existe ou foi movido. Que tal começar do início?
        </p>
        <a
          href="/"
          style={{
            display: 'inline-block',
            padding: '12px 28px',
            borderRadius: 10,
            background: 'var(--color-brand-blue, #1B5FA3)',
            color: '#fff',
            fontWeight: 700,
            fontSize: 15,
            textDecoration: 'none',
            fontFamily: 'inherit',
          }}
        >
          Voltar ao início
        </a>
      </div>
    </div>
  )
}
