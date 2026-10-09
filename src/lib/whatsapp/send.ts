import { logger } from '@/lib/logger'
import { normalizarNumero } from './phone'

type EnviarTextoArgs = {
  token: string
  phoneNumberId: string
  para: string
  mensagem: string
}

export async function enviarTexto({
  token,
  phoneNumberId,
  para,
  mensagem,
}: EnviarTextoArgs): Promise<void> {
  if (!token) {
    logger.warn('sem token para o cliente', { phoneNumberId })
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

// Marca a mensagem como lida e mostra "digitando…" (dura até 25s, sem renovação).
// Nunca lança: é um detalhe de experiência e não pode derrubar o atendimento.
export async function marcarComoLidaEDigitando({
  token,
  phoneNumberId,
  wamid,
}: {
  token: string
  phoneNumberId: string
  wamid: string
}): Promise<void> {
  if (!token) return
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: wamid,
        typing_indicator: { type: 'text' },
      }),
    })
    if (!res.ok) {
      const texto = await res.text().catch(() => '')
      logger.warn('falha ao marcar como lida/digitando', {
        phoneNumberId,
        status: res.status,
        resposta: texto,
      })
    }
  } catch (err) {
    logger.warn('erro ao marcar como lida/digitando', {
      phoneNumberId,
      erro: err instanceof Error ? err.message : String(err),
    })
  }
}
