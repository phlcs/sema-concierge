import { resend, resendModo } from '@/lib/integrations/resend'
import { registrarEvento } from '@/lib/eventos'
import { nomeRemetente, type PacoteEncaminhamento } from './pacote'

// Entrega do encaminhamento (T10): o pacote é o mesmo para qualquer destino; o
// destino vem do cadastro do cliente. Só o e-mail existe por enquanto; um destino
// novo (webhook, CRM) entra aqui, sem mexer em conversa, modo ou limite.

export type ClienteDestino = {
  id: string
  nomeNegocio: string
  destinoEncaminhamento: string
  emailPrestador: string
  nomeRemetente: string | null
}

export type ResultadoEntrega =
  | { ok: true; destino: string; id: string; modo: 'real' | 'mock' }
  | { ok: false; destino: string; motivo: 'destino_desconhecido' | 'success_false'; id?: string }

// Pode lançar (falha de rede, chave ausente): quem chama registra o erro
export async function entregarEncaminhamento(args: {
  cliente: ClienteDestino
  pacote: PacoteEncaminhamento
  // Para o detalhe dos eventos
  conversaId: string
}): Promise<ResultadoEntrega> {
  const { cliente, pacote, conversaId } = args
  const destino = cliente.destinoEncaminhamento

  switch (destino) {
    case 'email': {
      const r = await resend.enviarEncaminhamento({
        para: cliente.emailPrestador,
        remetente: nomeRemetente(cliente),
        pacote,
      })
      return r.success
        ? { ok: true, destino, id: r.id, modo: resendModo }
        : { ok: false, destino, motivo: 'success_false', id: r.id }
    }
    default:
      await registrarEvento('encaminhamento_destino_desconhecido', {
        clienteId: cliente.id,
        detalhe: { conversaId, destino, tipo: pacote.tipo },
      })
      return { ok: false, destino, motivo: 'destino_desconhecido' }
  }
}
