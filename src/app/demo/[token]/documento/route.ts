import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { carregarDemo } from '@/lib/demo/acesso'

// PDF mostrado como anexo no link de teste (T14). Só entrega com o link liberado e só
// documento do próprio cliente, pronto e marcado como "pode ser enviado".
export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const acesso = await carregarDemo(token)
  if (acesso.estado !== 'ativa') return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const nome = req.nextUrl.searchParams.get('nome')?.trim()
  if (!nome) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const doc = await prisma.documento.findFirst({
    where: { clienteId: acesso.demo.id, nome, status: 'pronto', podeEnviar: true },
    select: { conteudo: true, arquivoNome: true },
  })
  if (!doc) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  return new NextResponse(new Uint8Array(doc.conteudo), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(doc.arquivoNome)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
