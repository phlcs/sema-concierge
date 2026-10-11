import { prisma } from '@/lib/prisma'

// Interruptor geral de manutenção (T5).
//
// Regra de ouro: o botão de manutenção de cada cliente manda mais que o interruptor
// geral. Por isso o geral guarda a lista de clientes que ELE colocou em manutenção e
// "voltar ao normal" reativa só esses. Quem já estava em manutenção antes continua; e
// quem teve o botão mexido à mão enquanto o geral estava ligado sai da lista (ver
// retirarDaListaDoGeral, chamado pela rota de status do cliente).

const ID = 'geral'

export type EstadoInterruptor = {
  ligado: boolean
  ligadoEm: Date | null
  // Quantos clientes o geral colocou em manutenção e ainda não devolveu
  afetados: number
}

export async function lerInterruptor(): Promise<EstadoInterruptor> {
  const linha = await prisma.interruptorGeral.findUnique({ where: { id: ID } })
  if (!linha) return { ligado: false, ligadoEm: null, afetados: 0 }
  return { ligado: linha.ligado, ligadoEm: linha.ligadoEm, afetados: linha.clientesIds.length }
}

// Coloca em manutenção todos os clientes que estão ATIVOS. Os que já estão em
// manutenção (ou com outro status) não são tocados nem entram na lista.
export async function ligarInterruptorGeral(): Promise<{ afetados: number }> {
  return prisma.$transaction(async (tx) => {
    const ativos = await tx.cliente.findMany({ where: { status: 'ativo' }, select: { id: true } })
    const ids = ativos.map((c) => c.id)

    // O filtro de status no update protege contra um botão mexido entre a leitura e a escrita
    const { count } = await tx.cliente.updateMany({
      where: { id: { in: ids }, status: 'ativo' },
      data: { status: 'manutencao' },
    })

    // Aperta de novo com o geral já ligado: soma à lista, sem perder os de antes
    const atual = await tx.interruptorGeral.findUnique({ where: { id: ID } })
    const lista = [...new Set([...(atual?.clientesIds ?? []), ...ids])]
    await tx.interruptorGeral.upsert({
      where: { id: ID },
      create: { id: ID, ligado: true, ligadoEm: new Date(), clientesIds: lista },
      update: {
        ligado: true,
        ligadoEm: atual?.ligado ? atual.ligadoEm : new Date(),
        clientesIds: lista,
      },
    })
    return { afetados: count }
  })
}

// Volta ao normal: reativa só os clientes da lista que continuam em manutenção.
export async function desligarInterruptorGeral(): Promise<{ restaurados: number }> {
  return prisma.$transaction(async (tx) => {
    const atual = await tx.interruptorGeral.findUnique({ where: { id: ID } })
    if (!atual) return { restaurados: 0 }

    const { count } = await tx.cliente.updateMany({
      where: { id: { in: atual.clientesIds }, status: 'manutencao' },
      data: { status: 'ativo' },
    })
    await tx.interruptorGeral.update({
      where: { id: ID },
      data: { ligado: false, ligadoEm: null, clientesIds: [] },
    })
    return { restaurados: count }
  })
}

// O botão do cliente foi usado à mão: a escolha vale e o cliente deixa de ser do geral.
// Atômico no banco (sem ler e regravar a lista).
export async function retirarDaListaDoGeral(clienteId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "InterruptorGeral"
    SET "clientesIds" = array_remove("clientesIds", ${clienteId})
    WHERE "id" = ${ID}`
}
