import Redis from 'ioredis'
import { logger } from '@/lib/logger'

let _redis: Redis | undefined

export function getRedis(): Redis {
  if (_redis) return _redis

  const url = process.env.REDIS_URL
  if (!url) throw new Error('REDIS_URL não está configurado')

  _redis = new Redis(url, {
    maxRetriesPerRequest: 2,
    // Timeout curto: o webhook não pode ficar esperando um Redis fora do ar
    // (commandTimeout também vale para comando parado na fila offline).
    connectTimeout: 1500,
    commandTimeout: 1500,
    lazyConnect: false,
  })

  _redis.on('error', (err) => {
    logger.error('Redis connection error', { message: err.message })
  })

  return _redis
}
