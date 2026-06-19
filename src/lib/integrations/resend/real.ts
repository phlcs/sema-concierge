import type {
  ResendAdapter,
  HandoffInput,
  EmailResult,
} from './types'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatarQuando(quando: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(quando)
}

function montarHtml(input: HandoffInput): string {
  const naoInformado = 'não informado'
  const nome = input.leadNome ?? naoInformado
  const intencao = input.leadIntencao ?? naoInformado
  const resumo = input.leadResumo ?? naoInformado
  const quando = formatarQuando(input.quando)

  return `<!doctype html>
<html lang="pt-BR">
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111; line-height: 1.5;">
    <h2 style="margin-bottom: 16px;">Novo lead — ${escapeHtml(input.nomeNegocio)}</h2>
    <p><strong>Nome:</strong> ${escapeHtml(nome)}</p>
    <p><strong>Contato:</strong> ${escapeHtml(input.leadContato)}</p>
    <p><strong>O que quer:</strong> ${escapeHtml(intencao)}</p>
    <p><strong>Resumo:</strong> ${escapeHtml(resumo)}</p>
    <p><strong>Quando:</strong> ${escapeHtml(quando)}</p>
  </body>
</html>`
}

export const resendReal: ResendAdapter = {
  async sendBookingConfirmation() {
    throw new Error('[resend real] sendBookingConfirmation não implementado')
  },

  async enviarHandoff(input: HandoffInput): Promise<EmailResult> {
    const apiKey = process.env.RESEND_API_KEY
    const from = process.env.RESEND_FROM_EMAIL

    if (!apiKey) {
      throw new Error('[resend real] RESEND_API_KEY ausente')
    }
    if (!from) {
      throw new Error('[resend real] RESEND_FROM_EMAIL ausente')
    }

    const body = {
      from,
      to: input.emailPrestador,
      subject: `Novo lead — ${input.nomeNegocio}`,
      html: montarHtml(input),
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const texto = await res.text().catch(() => '')
      throw new Error(`[resend real] falha ao enviar handoff: status=${res.status} resposta=${texto}`)
    }

    const data = (await res.json()) as { id?: string }
    if (!data.id) {
      throw new Error('[resend real] resposta sem id da Resend')
    }
    return { id: data.id, success: true }
  },
}
