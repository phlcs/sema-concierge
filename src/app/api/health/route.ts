import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getRedis } from '@/lib/ratelimit/redis'

async function checkDb(): Promise<'ok' | 'error'> {
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
    ])
    return 'ok'
  } catch {
    return 'error'
  }
}

async function checkRedis(): Promise<'ok' | 'error'> {
  try {
    const redis = getRedis()
    await Promise.race([
      redis.ping(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
    ])
    return 'ok'
  } catch {
    return 'error'
  }
}

export async function GET() {
  const [db, redis] = await Promise.all([checkDb(), checkRedis()])
  const status = db === 'ok' && redis === 'ok' ? 'ok' : 'degraded'

  return NextResponse.json(
    { status, db, redis, timestamp: new Date().toISOString() },
    { status: status === 'ok' ? 200 : 503 }
  )
}
