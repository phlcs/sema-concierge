import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { makeAuthCookie, signToken } from '@/lib/auth'
import { ADMIN_SUB } from '@/lib/admin/guard'

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  // Compare against a buffer of the same length to keep timing constant,
  // then AND with a length-equality check so different lengths still fail.
  const len = Math.max(ab.length, bb.length, 1)
  const ap = Buffer.alloc(len)
  const bp = Buffer.alloc(len)
  ab.copy(ap)
  bb.copy(bp)
  const eq = timingSafeEqual(ap, bp)
  return eq && ab.length === bb.length
}

export async function POST(req: Request) {
  const expected = process.env.ADMIN_PASSWORD
  if (!expected || expected.length === 0) {
    console.error('[admin/login] ADMIN_PASSWORD não definida — login recusado')
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let provided = ''
  try {
    const body = (await req.json()) as { password?: unknown }
    if (typeof body?.password === 'string') provided = body.password
  } catch {
    // body inválido cai no compare e falha
  }

  if (!safeEqual(provided, expected)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const token = signToken({ sub: ADMIN_SUB, email: '', name: '' })
  return new NextResponse(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': makeAuthCookie(token),
    },
  })
}
