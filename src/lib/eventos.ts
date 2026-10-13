import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

export type Tema = 'Recebimento' | 'IA e resposta' | 'Envio' | 'Encaminhamento' | 'Interno'
export type Gravidade = 'Erro' | 'Aviso' | 'Informativo'

export const TEMAS: Tema[] = ['Recebimento', 'IA e resposta', 'Envio', 'Encaminhamento', 'Interno']
export const GRAVIDADES: Gravidade[] = ['Erro', 'Aviso', 'Informativo']

// Catálogo da T5. Tema, nome e gravidade vivem aqui, num lugar só: quem registra
// só diz a chave. Eventos de funções ainda não construídas (busca em documentos)
// entram neste catálogo quando a função existir.
const CATALOGO = {
  webhook_erro_geral: { tema: 'Recebimento', evento: 'Erro geral do webhook', gravidade: 'Erro' },
  webhook_assinatura_recusada: {
    tema: 'Recebimento',
    evento: 'Assinatura do webhook recusada',
    gravidade: 'Aviso',
  },
  cliente_nao_encontrado: {
    tema: 'Recebimento',
    evento: 'Cliente não encontrado ou inativo',
    gravidade: 'Aviso',
  },
  entrada_bloqueada: {
    tema: 'Recebimento',
    evento: 'Entrada bloqueada pelo filtro',
    gravidade: 'Aviso',
  },
  mensagem_duplicada: {
    tema: 'Recebimento',
    evento: 'Mensagem descartada por ser cópia',
    gravidade: 'Informativo',
  },
  midia_recebida: { tema: 'Recebimento', evento: 'Mídia recebida', gravidade: 'Informativo' },
  mensagem_de_anuncio: {
    tema: 'Recebimento',
    evento: 'Mensagem vinda de anúncio',
    gravidade: 'Informativo',
  },
  ia_erro_provedor: { tema: 'IA e resposta', evento: 'Erro do provedor de IA', gravidade: 'Erro' },
  ia_falha_leitura: {
    tema: 'IA e resposta',
    evento: 'Falha ao ler a resposta da IA',
    gravidade: 'Erro',
  },
  ia_vazamento: { tema: 'IA e resposta', evento: 'Vazamento detectado', gravidade: 'Aviso' },
  resumo_falha: {
    tema: 'IA e resposta',
    evento: 'Falha ao gerar resumo da conversa',
    gravidade: 'Erro',
  },
  manutencao_resposta_automatica: {
    tema: 'IA e resposta',
    evento: 'Resposta automática de manutenção',
    gravidade: 'Informativo',
  },
  envio_falha_meta: { tema: 'Envio', evento: 'Falha no envio para a Meta', gravidade: 'Erro' },
  envio_sem_token: { tema: 'Envio', evento: 'Sem token do WhatsApp', gravidade: 'Erro' },
  encaminhamento_falha_email: {
    tema: 'Encaminhamento',
    evento: 'Falha no envio do e-mail de encaminhamento',
    gravidade: 'Erro',
  },
  encaminhamento_enviado: {
    tema: 'Encaminhamento',
    evento: 'Encaminhamento enviado',
    gravidade: 'Informativo',
  },
  encaminhamento_recusado_campo: {
    tema: 'Encaminhamento',
    evento: 'Encaminhamento recusado por campo faltando',
    gravidade: 'Aviso',
  },
  encaminhamento_limite_atingido: {
    tema: 'Encaminhamento',
    evento: 'Limite diário de encaminhamentos atingido',
    gravidade: 'Aviso',
  },
  encaminhamento_destino_desconhecido: {
    tema: 'Encaminhamento',
    evento: 'Destino do encaminhamento não implementado',
    gravidade: 'Erro',
  },
  encaminhamento_mock: {
    tema: 'Encaminhamento',
    evento: 'Encaminhamento em modo de teste (mock)',
    gravidade: 'Informativo',
  },
  conversa_marcada_revisao: {
    tema: 'Interno',
    evento: 'Conversa marcada para revisão',
    gravidade: 'Informativo',
  },
  revisao_erro: { tema: 'Interno', evento: 'Erro na marcação de revisão', gravidade: 'Aviso' },
  teste_liberado: { tema: 'Interno', evento: 'Link de teste liberado', gravidade: 'Informativo' },
  teste_bloqueado: { tema: 'Interno', evento: 'Link de teste bloqueado', gravidade: 'Informativo' },
} as const satisfies Record<string, { tema: Tema; evento: string; gravidade: Gravidade }>

export type ChaveEvento = keyof typeof CATALOGO

// Só identificadores e códigos: nada de texto de mensagem, nome, telefone ou e-mail.
export type DetalheEvento = Record<string, string | number | boolean | null>

// Resumo seguro de um erro para o detalhe: tipo e, se houver, o status HTTP. A
// mensagem completa fica só no log do servidor (pode citar trechos do conteúdo).
export function resumoErro(err: unknown): DetalheEvento {
  if (!(err instanceof Error)) return { erroTipo: typeof err }
  const status = (err as { status?: unknown }).status
  return {
    erroTipo: err.name,
    ...(typeof status === 'number' ? { status } : {}),
  }
}

// Grava o evento. Nunca lança nem atrasa o atendimento: se o banco falhar, só
// deixa uma linha no log.
export async function registrarEvento(
  chave: ChaveEvento,
  args: { clienteId?: string | null; detalhe?: DetalheEvento } = {},
): Promise<void> {
  const def = CATALOGO[chave]
  try {
    await prisma.evento.create({
      data: {
        tema: def.tema,
        evento: def.evento,
        gravidade: def.gravidade,
        clienteId: args.clienteId ?? null,
        detalhe: args.detalhe ?? undefined,
      },
    })
  } catch (err) {
    logger.error('eventos: falha ao gravar evento', {
      chave,
      erro: err instanceof Error ? err.message : String(err),
    })
  }
}
