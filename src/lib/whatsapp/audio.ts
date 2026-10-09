import { logger } from '@/lib/logger'
import { transcreverAudio } from '@/lib/ai/transcricao'
import { duracaoOggOpusSegundos } from './audio-duracao'
import { baixarMidia, MidiaGrandeDemais } from './midia'

// Marcador gravado junto do texto: aparece no histórico, no painel e para a IA
export const PREFIXO_AUDIO = '[áudio transcrito]'

export const LIMITE_AUDIO_SEGUNDOS = 150 // 2min30

// Teto de bytes: protege o download e serve de proxy de duração para o que não é
// Ogg/Opus (mp3, m4a... enviados como arquivo), cuja duração não dá para ler de graça.
// 2,5 MB ≈ 2min30 a 128 kbps; nota de voz do WhatsApp (~32 kbps) fica bem abaixo.
export const LIMITE_AUDIO_BYTES = 2_500_000

export type ResultadoAudio =
  | { ok: true; texto: string }
  | { ok: false; motivo: 'longo' | 'falha' }

// Nunca lança: qualquer erro vira { ok: false, motivo: 'falha' }
export async function obterTextoDoAudio(mediaId: string): Promise<ResultadoAudio> {
  try {
    const { buffer, mime } = await baixarMidia({
      mediaId,
      token: process.env.WHATSAPP_TOKEN ?? '',
      maxBytes: LIMITE_AUDIO_BYTES,
    })

    const duracao = duracaoOggOpusSegundos(buffer)
    if (duracao != null && duracao > LIMITE_AUDIO_SEGUNDOS) {
      logger.info('audio: acima do limite, não transcrito', { segundos: Math.round(duracao) })
      return { ok: false, motivo: 'longo' }
    }

    const texto = await transcreverAudio(buffer, mime)
    return { ok: true, texto: `${PREFIXO_AUDIO} ${texto}` }
  } catch (err) {
    if (err instanceof MidiaGrandeDemais) {
      logger.info('audio: arquivo acima do limite, não transcrito', { bytes: err.bytes })
      return { ok: false, motivo: 'longo' }
    }
    logger.warn('audio: falha ao transcrever', {
      erro: err instanceof Error ? err.message : String(err),
    })
    return { ok: false, motivo: 'falha' }
  }
}

// A transcrição começa na chegada do áudio e corre durante a espera do turno; o
// turno só pega o resultado quando fecha. O mapa é do processo (o servidor é
// persistente); se faltar a entrada (reinício), refaz a partir do media ID.
const EM_ANDAMENTO = new Map<string, Promise<ResultadoAudio>>()
const TTL_MS = 5 * 60 * 1000

export function iniciarTranscricao(wamid: string, mediaId: string): void {
  if (EM_ANDAMENTO.has(wamid)) return
  EM_ANDAMENTO.set(wamid, obterTextoDoAudio(mediaId))
  setTimeout(() => EM_ANDAMENTO.delete(wamid), TTL_MS).unref()
}

export async function aguardarTranscricao(wamid: string, mediaId: string): Promise<ResultadoAudio> {
  const emAndamento = EM_ANDAMENTO.get(wamid)
  EM_ANDAMENTO.delete(wamid)
  return emAndamento ?? obterTextoDoAudio(mediaId)
}
