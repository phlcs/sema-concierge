import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken, COOKIE_NAME } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import ChatPage from './ChatPage'

export default async function ChatRoute({
  searchParams,
}: {
  searchParams: Promise<{ action?: string }>
}) {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  if (!token) redirect('/login')
  const payload = verifyToken(token)
  if (!payload) redirect('/login')

  const [rows, params] = await Promise.all([
    prisma.conversation.findMany({
      where: { userId: payload.sub },
      orderBy: { updatedAt: 'desc' },
      include: {
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    }),
    searchParams,
  ])

  const initialConversations = rows.map((c) => {
    const last = c.messages[0]
    let preview = ''
    if (last) {
      const content = last.content as Record<string, unknown>
      if (last.role === 'USER') preview = String(content.text ?? '').slice(0, 60)
      else if (Array.isArray(content.paragraphs))
        preview = String(content.paragraphs[0] ?? '').slice(0, 60)
    }
    return { id: c.id, title: c.title, updatedAt: c.updatedAt.getTime(), preview }
  })

  return (
    <ChatPage
      user={{ id: payload.sub, name: payload.name, email: payload.email }}
      initialConversations={initialConversations}
      autoBook={params.action === 'book'}
    />
  )
}
