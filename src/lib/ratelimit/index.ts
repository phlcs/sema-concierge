import { getRedis } from './redis'
import { logger } from '@/lib/logger'

const DAILY_GLOBAL_LIMIT = parseInt(process.env.DAILY_GLOBAL_LIMIT ?? '200', 10)
const DAILY_USER_LIMIT = parseInt(process.env.DAILY_USER_LIMIT ?? '5', 10)
const MIN_SECONDS = parseInt(process.env.MIN_SECONDS_BETWEEN_MESSAGES ?? '8', 10)

type RateLimitOk = { ok: true }
type RateLimitBlocked =
  | { ok: false; reason: 'user_daily' }
  | { ok: false; reason: 'global_daily' }
  | { ok: false; reason: 'too_fast'; retryAfterSeconds: number }

export type RateLimitResult = RateLimitOk | RateLimitBlocked

function todayKey(): string {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
}

export async function checkRateLimit({
  userId,
  ip,
  fingerprint,
}: {
  userId: string
  ip: string
  fingerprint: string
}): Promise<RateLimitResult> {
  const redis = getRedis()
  void ip
  void fingerprint

  const today = todayKey()

  // ── a) Limite global (kill switch) ──────────────────────────────────────────
  const globalKey = `ratelimit:global:${today}`
  const globalPipeline = redis.pipeline()
  globalPipeline.incr(globalKey)
  globalPipeline.expire(globalKey, 86400)
  const globalResults = await globalPipeline.exec()
  const globalCount = (globalResults?.[0]?.[1] as number) ?? 0

  if (globalCount >= DAILY_GLOBAL_LIMIT * 0.5 && globalCount < DAILY_GLOBAL_LIMIT * 0.8) {
    logger.warn('RateLimit: global usage at 50%', { count: globalCount, limit: DAILY_GLOBAL_LIMIT })
  } else if (globalCount >= DAILY_GLOBAL_LIMIT * 0.8 && globalCount < DAILY_GLOBAL_LIMIT) {
    logger.warn('RateLimit: global usage at 80%', { count: globalCount, limit: DAILY_GLOBAL_LIMIT })
  } else if (globalCount >= DAILY_GLOBAL_LIMIT) {
    logger.error('RateLimit: global limit reached — blocking all users', { count: globalCount, limit: DAILY_GLOBAL_LIMIT })
    return { ok: false, reason: 'global_daily' }
  }

  // ── b) Limite por usuário ────────────────────────────────────────────────────
  const userKey = `ratelimit:user:${userId}:${today}`
  const userPipeline = redis.pipeline()
  userPipeline.incr(userKey)
  userPipeline.expire(userKey, 86400)
  const userResults = await userPipeline.exec()
  const userCount = (userResults?.[0]?.[1] as number) ?? 0

  if (userCount > DAILY_USER_LIMIT) {
    // Decrement global counter since we're blocking this user
    await redis.decr(globalKey)
    return { ok: false, reason: 'user_daily' }
  }

  // ── c) Velocidade mínima entre mensagens ────────────────────────────────────
  const lastKey = `ratelimit:lastmsg:${userId}`
  const now = Date.now()
  const lastTs = await redis.get(lastKey)

  if (lastTs) {
    const diffSeconds = (now - parseInt(lastTs, 10)) / 1000
    if (diffSeconds < MIN_SECONDS) {
      // Decrement both counters since we're blocking
      await redis.pipeline().decr(globalKey).decr(userKey).exec()
      return {
        ok: false,
        reason: 'too_fast',
        retryAfterSeconds: Math.ceil(MIN_SECONDS - diffSeconds),
      }
    }
  }

  await redis.set(lastKey, String(now), 'EX', 60)

  return { ok: true }
}
