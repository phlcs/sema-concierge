import { parseArgs } from 'node:util'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { Base, PROMPT, VERSAO, recorte, validarDecisao } from './core'

async function main() {
  const { values: args } = parseArgs({ options: {
    arquivo: { type: 'string' }, banco: { type: 'boolean' }, cliente: { type: 'string' },
    negocio: { type: 'string' }, ia: { type: 'boolean' }, limite: { type: 'string', default: '20' },
    saida: { type: 'string', default: 'recuperacao/resultados' }, agora: { type: 'string' },
  } })
  if (Boolean(args.arquivo) === Boolean(args.banco)) throw new Error('Escolha --arquivo ou --banco')
  const limite = Number(args.limite)
  if (!Number.isInteger(limite) || limite < 1 || limite > 500) throw new Error('Limite deve estar entre 1 e 500')
  const agora = new Date(args.agora ?? Date.now())
  if (!Number.isFinite(agora.getTime())) throw new Error('Data inválida')
  // Falha antes de qualquer leitura ou chamada se a configuração estiver incompleta.
  const chave = process.env.RECUPERACAO_ANTHROPIC_API_KEY
  const modelo = process.env.RECUPERACAO_MODELO
  if (args.ia && (!chave || !modelo)) throw new Error('Configure RECUPERACAO_ANTHROPIC_API_KEY e RECUPERACAO_MODELO')
  let entrada: unknown
  if (args.arquivo) entrada = JSON.parse(await readFile(args.arquivo, 'utf8'))
  else {
    if (process.env.RAILWAY_ENVIRONMENT_NAME !== 'staging') throw new Error('Leitura do banco permitida somente em staging')
    if (!args.cliente || !args.negocio || !process.env.RECUPERACAO_DATABASE_URL) throw new Error('Informe --cliente, --negocio e RECUPERACAO_DATABASE_URL (credencial somente leitura)')
    const { PrismaClient } = await import('../src/generated/prisma/client')
    const { PrismaPg } = await import('@prisma/adapter-pg')
    const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.RECUPERACAO_DATABASE_URL }) })
    try {
      const conversas = await db.$transaction(async tx => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
        return tx.whatsappConversation.findMany({
          where: { clienteId: args.cliente }, orderBy: { id: 'asc' }, take: limite,
          select: { id: true, mensagens: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: { id: true, role: true, texto: true, createdAt: true } },
          encaminhamentos: { select: { createdAt: true } } },
        })
      }, { timeout: 30_000 })
      entrada = JSON.parse(JSON.stringify({ clienteId: args.cliente, negocio: args.negocio, conversas }))
    } finally { await db.$disconnect() }
  }
  const base = Base.parse(entrada)
  const pasta = path.join(args.saida!, `${new Date().toISOString().replaceAll(':', '-')}-${crypto.randomUUID().slice(0, 8)}`)
  await mkdir(pasta, { recursive: true, mode: 0o700 })
  const client = args.ia ? new Anthropic({ apiKey: chave, maxRetries: 0, timeout: 30_000 }) : null
  const resultados = []
  await writeFile(path.join(pasta, 'revisao.json'), JSON.stringify({ versao: VERSAO, agora: agora.toISOString(), clienteId: base.clienteId, resultados: [] }, null, 2), { mode: 0o600 })
  for (const conversa of base.conversas.slice(0, limite)) {
    const snapshot = recorte(conversa, agora)
    if (!snapshot) continue
    let classificacao = { decisao: 'incerto', motivo: 'Simulação: IA não executada.', evidencias: [] as string[] }
    let status = 'simulacao'
    let uso: unknown = null
    if (snapshot.encaminhado) {
      classificacao = { decisao: 'nao_recuperar', motivo: 'Encaminhamento já registrado até o corte; exclusão conservadora do piloto.', evidencias: [] }
      status = 'regra'
    } else if (JSON.stringify(snapshot).length > 60_000) {
      classificacao.motivo = 'Histórico acima do limite de entrada; revisão manual necessária.'
      status = 'limite_contexto'
    } else if (client) {
      try {
        const resposta = await client.messages.create({ model: modelo!, max_tokens: 1200,
          system: PROMPT, messages: [{ role: 'user', content: JSON.stringify({ negocio: base.negocio, ...snapshot }) }] })
        uso = resposta.usage
        if (resposta.stop_reason !== 'end_turn') throw new Error('Resposta incompleta')
        classificacao = validarDecisao(resposta.content.filter(b => b.type === 'text').map(b => b.text).join(''), snapshot.mensagens.map(m => m.id))
        status = 'classificado'
      } catch {
        classificacao = { decisao: 'incerto', motivo: 'Falha de classificação; revisão manual necessária.', evidencias: [] }
        status = 'erro'
      }
    }
    resultados.push({ ...snapshot, status, classificacao, uso, revisao: { decisao: null, motivo: '', revisor: '' } })
    // Checkpoint por conversa; dados reais nunca vão para o log nem para o Git.
    await writeFile(path.join(pasta, 'revisao.json'), JSON.stringify({ versao: VERSAO, modelo: args.ia ? modelo : null, agora: agora.toISOString(), clienteId: base.clienteId, negocio: base.negocio, resultados }, null, 2), { mode: 0o600 })
  }
  const escapar = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  await writeFile(path.join(pasta, 'relatorio.html'), `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Revisão de recuperação</title><style>body{font:16px system-ui;max-width:960px;margin:40px auto;padding:20px}article{border-top:1px solid #ccc;padding:20px 0}pre{white-space:pre-wrap}small{color:#555}</style><h1>Revisão de recuperação</h1><p>${resultados.length} avaliações. ${args.ia ? 'Classificação assistida por IA.' : 'SIMULAÇÃO — decisões de IA ainda não executadas.'} Nenhuma mensagem enviada.</p><p>Registre sua decisão e justificativa no campo revisao do arquivo revisao.json.</p>${resultados.map(r => `<article><h2>${escapar(r.conversaId)}</h2><small>Corte: ${r.corte} · ${r.status}</small><p><b>${r.classificacao.decisao}</b> — ${escapar(r.classificacao.motivo)}</p><p>Evidências: ${escapar(r.classificacao.evidencias.join(', '))}</p>${r.mensagens.map(m => `<pre>${escapar(`${m.id} · ${m.createdAt} · ${m.role}\n${m.texto}`)}</pre>`).join('')}</article>`).join('')}</html>`, { mode: 0o600 })
  console.log(`Concluído: ${resultados.length} avaliações. Relatório: ${pasta}`)
}

main().catch(() => { console.error('Worker interrompido. Confira argumentos, credenciais e formato conforme recuperacao/README.md.'); process.exitCode = 1 })
