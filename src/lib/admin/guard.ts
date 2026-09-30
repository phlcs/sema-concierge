import { cookies } from 'next/headers'
import { COOKIE_NAME, verifyToken } from '@/lib/auth'

export const ADMIN_SUB = 'admin'

export async function isAdminAuthed(): Promise<boolean> {
  const store = await cookies()
  const token = store.get(COOKIE_NAME)?.value
  if (!token) return false
  const payload = verifyToken(token)
  return payload?.sub === ADMIN_SUB
}
