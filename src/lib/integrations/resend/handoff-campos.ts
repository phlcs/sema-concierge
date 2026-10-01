import type { HandoffInput } from './types'

// Formatação dos campos do email de handoff. Compartilhada com o card da demo,
// para que rótulos, datas e "não informado" sejam idênticos.

export function formatarQuando(quando: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(quando)
}

export function formatarDiaMes(quando: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
  }).format(quando)
}

export type CamposLead = {
  nome: string
  contato: string
  intencao: string
  resumo: string
  quando: string
}

export function camposDoLead(input: HandoffInput): CamposLead {
  const naoInformado = 'não informado'
  return {
    nome: input.leadNome ?? naoInformado,
    contato: input.leadContato,
    intencao: input.leadIntencao ?? naoInformado,
    resumo: input.leadResumo ?? naoInformado,
    quando: formatarQuando(input.quando),
  }
}

export function assuntoHandoff(quando: Date): string {
  return `Novo Lead - Sema ${formatarDiaMes(quando)}`
}
