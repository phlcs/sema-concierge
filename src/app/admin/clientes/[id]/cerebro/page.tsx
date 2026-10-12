import { redirect } from 'next/navigation'

// O cérebro passou a ser editado na tela de cadastro do cliente (T8)
export default async function CerebroPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/admin/clientes/${id}`)
}
