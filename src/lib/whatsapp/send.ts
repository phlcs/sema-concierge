import { logger } from '@/lib/logger'
import { normalizarNumero } from './phone'

type EnviarTextoArgs = {
  phoneNumberId: string
  para: string
  mensagem: string
}

export async function enviarTexto({
  phoneNumberId,
  para,
  mensagem,
}: EnviarTextoArgs): Promise<void> {
  const token = process.env.WHATSAPP_TOKEN
  if (!token) {
    logger.warn('WHATSAPP_TOKEN ausente')
    return
  }

  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`
  const body = {
    messaging_product: 'whatsapp',
    to: normalizarNumero(para),
    type: 'text',
    text: { body: mensagem },
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const texto = await res.text().catch(() => '')
    logger.error('falha ao enviar texto pelo WhatsApp', {
      phoneNumberId,
      status: res.status,
      resposta: texto,
    })
  }
}
