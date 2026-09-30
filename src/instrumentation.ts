export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  try {
    const { prisma } = await import('@/lib/prisma')

    const phoneNumberId = '000000000000000'

    await prisma.cliente.upsert({
      where: { phoneNumberId },
      update: {},
      create: {
        nomeNegocio: 'Teste',
        phoneNumberId,
        wabaId: 'fake-waba-id',
        whatsappToken: 'fake-whatsapp-token',
        emailPrestador: 'fake@example.com',
        cerebro: {},
        status: 'ativo',
      },
    })

    const cliente = await prisma.cliente.findUnique({ where: { phoneNumberId } })
    console.log('Cliente de teste lido: ' + cliente?.nomeNegocio)
  } catch (err) {
    console.error('Falha ao inicializar Cliente de teste:', err)
  }
}
