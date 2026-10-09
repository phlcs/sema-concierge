// A Meta não informa a duração do áudio no webhook. Notas de voz do WhatsApp são
// sempre Ogg/Opus, e a duração está no próprio arquivo: granule position da última
// página (amostras a 48 kHz) menos o pre-skip do cabeçalho OpusHead.

const OGG_MAGIC = Buffer.from('OggS')
const OPUS_HEAD = Buffer.from('OpusHead')
const TAXA_OPUS = 48_000

// Segundos de um Ogg/Opus; null se o arquivo não for Ogg/Opus legível
export function duracaoOggOpusSegundos(buf: Buffer): number | null {
  if (buf.length < 64 || !buf.subarray(0, 4).equals(OGG_MAGIC)) return null

  // Primeira página: segmentos e pacote OpusHead logo depois da tabela de segmentos
  const nSegmentos = buf[26]
  const inicioPacote = 27 + nSegmentos
  if (!buf.subarray(inicioPacote, inicioPacote + 8).equals(OPUS_HEAD)) return null
  const preSkip = buf.readUInt16LE(inicioPacote + 10)

  // Última página válida com granule position definido (-1 = sem pacote terminado nela)
  let pos = buf.length
  while ((pos = buf.lastIndexOf(OGG_MAGIC, pos - 1)) > 0) {
    if (pos + 14 > buf.length || buf[pos + 4] !== 0) continue // versão do formato Ogg é 0
    const baixo = buf.readUInt32LE(pos + 6)
    const alto = buf.readUInt32LE(pos + 10)
    if (alto === 0xffffffff && baixo === 0xffffffff) continue
    const amostras = alto * 2 ** 32 + baixo - preSkip
    return amostras > 0 ? amostras / TAXA_OPUS : 0
  }
  return null
}
