import { getRedis } from '@/lib/ratelimit/redis'
import { logger } from '@/lib/logger'

// Um turno do cliente = tudo que ele manda até ficar DEBOUNCE_MS sem mensagem nova.
// O buffer fica no Redis; a espera é um timer em processo (o servidor é persistente).
// Reinício do servidor no meio da espera perde o turno (risco aceito).

export type ItemTurno = {
  wamid: string
  tipo: 'texto' | 'audio' | 'midia'
  texto?: string
  // só em tipo 'audio': a transcrição é buscada por ele; o áudio em si não é guardado
  mediaId?: string
  origemAnuncio: boolean
  recebidaEm: number
}

const DEDUPE_TTL_S = 7 * 24 * 60 * 60 // a Meta reenvia por até 7 dias
const BUFFER_TTL_S = 60 * 60
const MAX_ITENS = 50 // teto de segurança por turno

function debounceMs(): number {
  const n = Number(process.env.WHATSAPP_DEBOUNCE_MS)
  return Number.isFinite(n) && n >= 0 && process.env.WHATSAPP_DEBOUNCE_MS ? n : 10_000
}

// Redis indisponível (sem conexão, timeout ou erro de comando): a mensagem é
// processada na hora, sem espera, junção nem descarte de duplicada.
// Não registra texto, número nem wamid (o wamid embute o telefone).
export function avisarModoDegradado(etapa: 'recebimento' | 'fechamento', err: unknown): void {
  logger.warn(
    'whatsapp: Redis indisponível, processando a mensagem na hora (sem espera, junção nem descarte de duplicada)',
    { etapa, erro: err instanceof Error ? err.message : String(err) },
  )
}

// true na primeira vez que vê o wamid; false se for repetido
export async function registrarSeNova(wamid: string): Promise<boolean> {
  const res = await getRedis().set(`wa:dedupe:${wamid}`, '1', 'EX', DEDUPE_TTL_S, 'NX')
  return res === 'OK'
}

export type TratarTurno = (args: {
  phoneNumberId: string
  deNumero: string
  itens: ItemTurno[]
}) => Promise<void>

// Põe a mensagem no buffer do contato e (re)inicia a espera
export async function adicionarAoTurno(args: {
  phoneNumberId: string
  deNumero: string
  item: ItemTurno
  tratar: TratarTurno
}): Promise<void> {
  const { phoneNumberId, deNumero, item, tratar } = args
  const chave = `${phoneNumberId}:${deNumero}`
  const bufKey = `wa:buf:${chave}`
  const seqKey = `wa:seq:${chave}`

  const redis = getRedis()
  const res = await redis
    .multi()
    .rpush(bufKey, JSON.stringify(item))
    .ltrim(bufKey, -MAX_ITENS, -1)
    .expire(bufKey, BUFFER_TTL_S)
    .incr(seqKey)
    .expire(seqKey, BUFFER_TTL_S)
    .exec()
  const seq = Number(res?.[3]?.[1])
  if (!Number.isFinite(seq)) throw new Error('falha ao registrar mensagem no buffer do turno')

  setTimeout(() => {
    fecharTurno({ bufKey, seqKey, seq, phoneNumberId, deNumero, item, tratar }).catch((err) => {
      logger.error('erro ao fechar turno do WhatsApp', {
        erro: err instanceof Error ? err.message : String(err),
      })
    })
  }, debounceMs())
}

async function fecharTurno(args: {
  bufKey: string
  seqKey: string
  seq: number
  phoneNumberId: string
  deNumero: string
  item: ItemTurno
  tratar: TratarTurno
}): Promise<void> {
  const { bufKey, seqKey, seq, phoneNumberId, deNumero, item, tratar } = args

  let brutos: string[]
  try {
    const redis = getRedis()

    // Chegou mensagem mais nova: o timer dela é quem fecha o turno
    const atual = Number(await redis.get(seqKey))
    if (atual !== seq) return

    const res = await redis.multi().lrange(bufKey, 0, -1).del(bufKey).exec()
    const falha = res?.find(([err]) => err)?.[0]
    if (!res || falha) throw falha ?? new Error('falha ao ler o buffer do turno')
    brutos = (res[0][1] as string[] | null) ?? []
  } catch (err) {
    // Redis caiu durante a espera: responde só a mensagem que este timer guarda
    avisarModoDegradado('fechamento', err)
    await tratar({ phoneNumberId, deNumero, itens: [item] })
    return
  }
  if (brutos.length === 0) return // outro timer já levou o turno

  const itens = brutos.map((b) => JSON.parse(b) as ItemTurno)
  await tratar({ phoneNumberId, deNumero, itens })
}
