import { logger } from '@/lib/logger'

export type MidiaBaixada = { buffer: Buffer; mime: string }

export class MidiaGrandeDemais extends Error {
  constructor(readonly bytes: number) {
    super(`mídia maior que o limite (${bytes} bytes)`)
  }
}

const TIMEOUT_MS = 10_000

// Baixa a mídia pelo media ID. A URL devolvida pela Meta vale 5 minutos, então o
// download acontece logo em seguida. O conteúdo fica só em memória: nunca é gravado.
// `maxBytes` evita baixar arquivo enorme (checado no tamanho informado e no recebido).
export async function baixarMidia(args: {
  mediaId: string
  token: string
  maxBytes: number
}): Promise<MidiaBaixada> {
  const { mediaId, token, maxBytes } = args
  if (!token) throw new Error('WHATSAPP_TOKEN não configurado')
  const headers = { Authorization: `Bearer ${token}` }

  const metaRes = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(mediaId)}`, {
    headers,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!metaRes.ok) {
    logger.warn('midia: falha ao obter a URL da mídia', { status: metaRes.status })
    throw new Error(`Graph API respondeu ${metaRes.status} ao obter a mídia`)
  }
  const meta = (await metaRes.json()) as { url?: string; mime_type?: string; file_size?: number }
  if (!meta.url) throw new Error('Graph API não devolveu a URL da mídia')
  if (typeof meta.file_size === 'number' && meta.file_size > maxBytes) {
    throw new MidiaGrandeDemais(meta.file_size)
  }

  const res = await fetch(meta.url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) {
    logger.warn('midia: falha ao baixar a mídia', { status: res.status })
    throw new Error(`download da mídia respondeu ${res.status}`)
  }
  const buffer = Buffer.from(await res.arrayBuffer())
  if (buffer.length > maxBytes) throw new MidiaGrandeDemais(buffer.length)

  return { buffer, mime: meta.mime_type ?? res.headers.get('content-type') ?? 'audio/ogg' }
}
