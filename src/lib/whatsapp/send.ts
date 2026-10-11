import { logger } from '@/lib/logger'
import { registrarEvento, resumoErro } from '@/lib/eventos'
import { normalizarNumero } from './phone'

type EnviarTextoArgs = {
  token: string
  phoneNumberId: string
  para: string
  mensagem: string
  // Só para o registro de eventos
  clienteId?: string
}

// Código de erro da Graph API (error.code), se o corpo vier no formato esperado
function codigoDoErroMeta(corpo: string): number | null {
  try {
    const codigo = (JSON.parse(corpo) as { error?: { code?: unknown } })?.error?.code
    return typeof codigo === 'number' ? codigo : null
  } catch {
    return null
  }
}

export async function enviarTexto({
  token,
  phoneNumberId,
  para,
  mensagem,
  clienteId,
}: EnviarTextoArgs): Promise<void> {
  if (!token) {
    logger.warn('sem token para o cliente', { phoneNumberId })
    await registrarEvento('envio_sem_token', { clienteId, detalhe: { phoneNumberId } })
    return
  }
  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`
  const body = {
    messaging_product: 'whatsapp',
    to: normalizarNumero(para),
    type: 'text',
    text: { body: mensagem },
  }

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    // Rede fora do ar etc.: registra e segue lançando, como antes
    await registrarEvento('envio_falha_meta', {
      clienteId,
      detalhe: { phoneNumberId, ...resumoErro(err) },
    })
    throw err
  }

  if (!res.ok) {
    const texto = await res.text().catch(() => '')
    logger.error('falha ao enviar texto pelo WhatsApp', {
      phoneNumberId,
      status: res.status,
      resposta: texto,
    })
    await registrarEvento('envio_falha_meta', {
      clienteId,
      detalhe: { phoneNumberId, status: res.status, codigoMeta: codigoDoErroMeta(texto) },
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
