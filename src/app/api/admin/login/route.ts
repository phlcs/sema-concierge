import { NextResponse } from 'next/server'
import { makeAuthCookie, signToken } from '@/lib/auth'
import { ADMIN_SUB } from '@/lib/admin/guard'
import { safeEqual } from '@/lib/admin/senha'

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
