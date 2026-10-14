import { toFile } from 'openai'
import { clienteOpenAI } from './chave-openai'
import { logger } from '@/lib/logger'
import { estimarCustoTranscricaoUsd } from './precos'
import { registrarResposta, USO_VAZIO, type ContextoRegistro } from './registro'

const MODELO_PADRAO = 'gpt-4o-mini-transcribe'
const TIMEOUT_MS = 30_000

export function modeloDeAudio(): string {
  return process.env.AI_AUDIO_MODEL?.trim() || MODELO_PADRAO
}

const EXTENSOES: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'm4a',
  'audio/amr': 'amr',
  'audio/webm': 'webm',
  'audio/wav': 'wav',
}


// Devolve o texto do áudio. Lança se a chave faltar, a chamada falhar ou o texto vier vazio.
// O texto transcrito nunca vai para o log. Cada chamada deixa um registro técnico (T5);
// `segundos` é a duração do áudio quando dá para ler, base do custo estimado por minuto.
export async function transcreverAudio(
  buffer: Buffer,
  mime: string,
  contexto: ContextoRegistro,
  segundos: number | null = null,
): Promise<string> {
  const inicio = Date.now()
  const model = modeloDeAudio()
  const registrar = (args: {
    sucesso: boolean
    entrada: number | null
    saida: number | null
    segundos: number | null
  }) =>
    registrarResposta({
      contexto,
      funcao: 'transcricao',
      provedor: 'openai',
      modelo: model,
      uso: {
        ...USO_VAZIO,
        tokensEntrada: args.entrada,
        tokensSaida: args.saida,
      },
      tempoMs: Date.now() - inicio,
      // Chamada que falhou antes de responder não é cobrada
      custoEstimadoUsd:
        args.entrada != null || args.segundos != null
          ? estimarCustoTranscricaoUsd(model, {
              segundos: args.segundos,
              tokensEntrada: args.entrada,
              tokensSaida: args.saida,
            })
          : null,
      sucesso: args.sucesso,
    })

  let registrado = false
  try {
    const client = clienteOpenAI()

    const tipo = mime.split(';')[0].trim().toLowerCase()
    const file = await toFile(buffer, `audio.${EXTENSOES[tipo] ?? 'ogg'}`, { type: tipo })

    const res = await client.audio.transcriptions.create(
      { file, model, language: 'pt' },
      { timeout: TIMEOUT_MS },
    )

    logger.info('openai: áudio transcrito', { model, bytes: buffer.length, caracteres: res.text.length })

    // A chamada foi cobrada mesmo se o texto vier vazio; só o "sucesso" muda
    const texto = res.text.trim()
    const usage = res.usage
    registrado = true
    await registrar({
      sucesso: texto.length > 0,
      entrada: usage?.type === 'tokens' ? usage.input_tokens : null,
      saida: usage?.type === 'tokens' ? usage.output_tokens : null,
      segundos: usage?.type === 'duration' ? usage.seconds : segundos,
    })

    if (!texto) throw new Error('transcrição vazia')
    return texto
  } catch (err) {
    if (!registrado) {
      await registrar({ sucesso: false, entrada: null, saida: null, segundos: null })
    }
    throw err
  }
}
