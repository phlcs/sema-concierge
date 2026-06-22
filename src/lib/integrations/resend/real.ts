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

function formatarDiaMes(quando: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
  }).format(quando)
}

type CamposLead = {
  nome: string
  contato: string
  intencao: string
  resumo: string
  quando: string
}

function camposDoLead(input: HandoffInput): CamposLead {
  const naoInformado = 'não informado'
  return {
    nome: input.leadNome ?? naoInformado,
    contato: input.leadContato,
    intencao: input.leadIntencao ?? naoInformado,
    resumo: input.leadResumo ?? naoInformado,
    quando: formatarQuando(input.quando),
  }
}

function montarHtml(input: HandoffInput): string {
  const c = camposDoLead(input)
  const fontStack = "Arial, Helvetica, sans-serif"

  const linha = (rotulo: string, valor: string, destaque = false) => `
              <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #E4E8D6;">
                  <div style="font-family: ${fontStack}; font-size: 12px; color: #32572C; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 4px;">${escapeHtml(rotulo)}</div>
                  <div style="font-family: ${fontStack}; font-size: ${destaque ? '18px' : '15px'}; color: #0E1F0F; font-weight: ${destaque ? '700' : '400'}; line-height: 1.4;">${escapeHtml(valor)}</div>
                </td>
              </tr>`

  return `<!doctype html>
<html lang="pt-BR">
  <body style="margin: 0; padding: 0; background-color: #F4F6EC;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #F4F6EC;">
      <tr>
        <td align="center" style="padding: 32px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 560px; background-color: #FFFFFF; border: 1px solid #E4E8D6; border-top: 3px solid #91A955;">
            <tr>
              <td style="padding: 24px 28px 8px 28px;">
                <div style="font-family: ${fontStack}; font-size: 11px; color: #32572C; text-transform: uppercase; letter-spacing: 0.08em;">Sema</div>
                <div style="font-family: ${fontStack}; font-size: 20px; color: #142A15; font-weight: 700; margin-top: 4px;">Novo lead</div>
              </td>
            </tr>
            <tr>
              <td style="padding: 8px 28px 24px 28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  ${linha('Nome', c.nome, true)}
                  ${linha('Contato', c.contato)}
                  ${linha('O que quer', c.intencao)}
                  ${linha('Resumo', c.resumo)}
                  ${linha('Quando', c.quando)}
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

function montarTexto(input: HandoffInput): string {
  const c = camposDoLead(input)
  return [
    'Novo lead',
    '',
    `Nome: ${c.nome}`,
    `Contato: ${c.contato}`,
    `O que quer: ${c.intencao}`,
    `Resumo: ${c.resumo}`,
    `Quando: ${c.quando}`,
  ].join('\n')
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
      from: `Sema <${from}>`,
      to: input.emailPrestador,
      subject: `Novo Lead - Sema ${formatarDiaMes(input.quando)}`,
      html: montarHtml(input),
      text: montarTexto(input),
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
