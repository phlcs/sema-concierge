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

  console.log("DEBUG token -> tamanho:", token?.length, "final:", token?.slice(-4), "vazio:", !token)

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
