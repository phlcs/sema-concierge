import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recorte, validarDecisao, type ConversaEntrada } from './core'

const conversa = (): ConversaEntrada => ({ id: 'c1', encaminhamentos: [], mensagens: [
  { id: 'u1', role: 'USER', texto: 'Quanto custa?', createdAt: '2026-10-01T10:00:00.000Z' },
  { id: 'a1', role: 'ASSISTANT', texto: 'Qual serviço?', createdAt: '2026-10-01T10:01:00.000Z' },
] })
const agora = new Date('2026-10-05T00:00:00Z')
test('corte histórico não inclui resposta ou encaminhamento futuro', () => {
  const c = conversa()
  c.mensagens.push({ id: 'u2', role: 'USER', texto: 'Já comprei', createdAt: '2026-10-03T10:00:00.000Z' })
  c.encaminhamentos.push({ createdAt: '2026-10-03T10:02:00.000Z' })
  const r = recorte(c, agora)!
  assert.equal(r.corte, '2026-10-02T10:00:00.000Z')
  assert.deepEqual(r.mensagens.map(m => m.id), ['u1', 'a1'])
  assert.equal(r.encaminhado, false)
})
test('atividade antes ou exatamente no corte reinicia contagem', () => {
  for (const data of ['2026-10-02T09:59:00.000Z', '2026-10-02T10:00:00.000Z']) {
    const c = conversa()
    c.mensagens.push({ id: 'u2', role: 'USER', texto: 'Olá', createdAt: data })
    assert.equal(recorte(c, agora), null) // novo turno ainda sem resposta
  }
})
test('não classifica antes de 24h nem conversa sem resposta', () => {
  assert.equal(recorte(conversa(), new Date('2026-10-02T09:59:59Z')), null)
  const c = conversa(); c.mensagens.pop()
  assert.equal(recorte(c, agora), null)
})
test('encaminhamento anterior é identificado', () => {
  const c = conversa(); c.encaminhamentos.push({ createdAt: '2026-10-01T11:00:00.000Z' })
  assert.equal(recorte(c, agora)?.encaminhado, true)
})
test('rejeita JSON inválido, decisão desconhecida e evidência inventada', () => {
  for (const raw of ['texto', '{"decisao":"enviar"}', JSON.stringify({ decisao: 'recuperar', motivo: 'Interesse', evidencias: ['inexistente'] }), JSON.stringify({ decisao: 'recuperar', motivo: 'Interesse', evidencias: [] })]) {
    assert.throws(() => validarDecisao(raw, ['u1']))
  }
  assert.equal(validarDecisao(JSON.stringify({ decisao: 'recuperar', motivo: 'Perguntou preço', evidencias: ['u1'] }), ['u1']).decisao, 'recuperar')
})
