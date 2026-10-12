'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  CANAIS_DESVIO,
  DESTINOS,
  MODOS,
  TIPOS_CANAL,
  remetentePadrao,
  type CampoPedido,
  type CanaisFallback,
  type Canal,
  type ChaveDesvio,
} from '@/lib/admin/cadastro'

export type ValoresCadastro = {
  nomeNegocio: string
  cerebro: string
  modo: string
  camposPedido: CampoPedido[]
  emailPrestador: string
  nomeRemetente: string
  destinoEncaminhamento: string
  canaisFallback: CanaisFallback
  phoneNumberId: string
  wabaId: string
  numeroExibicao: string
}

type Props = {
  // Sem id = cliente novo
  id?: string
  status?: string
  // ID do número já gravado (o botão de ativar só aparece com ele salvo)
  phoneNumberIdSalvo?: string | null
  inicial: ValoresCadastro
}

const CANAL_VAZIO: Canal = { tipo: 'email', contato: '' }

export default function CadastroForm({ id, status, phoneNumberIdSalvo, inicial }: Props) {
  const router = useRouter()
  const [v, setV] = useState<ValoresCadastro>(inicial)
  const [erro, setErro] = useState<string | null>(null)
  const [sucesso, setSucesso] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const novo = !id

  function muda<K extends keyof ValoresCadastro>(campo: K, valor: ValoresCadastro[K]) {
    setV((atual) => ({ ...atual, [campo]: valor }))
    setErro(null)
    setSucesso(null)
  }

  function mudaCampoPedido(i: number, parcial: Partial<CampoPedido>) {
    muda(
      'camposPedido',
      v.camposPedido.map((c, j) => (j === i ? { ...c, ...parcial } : c)),
    )
  }

  function moveCampoPedido(i: number, delta: number) {
    const j = i + delta
    if (j < 0 || j >= v.camposPedido.length) return
    const lista = [...v.camposPedido]
    ;[lista[i], lista[j]] = [lista[j], lista[i]]
    muda('camposPedido', lista)
  }

  function mudaCanal(chave: 'principal' | ChaveDesvio, parcial: Partial<Canal>) {
    const atual = v.canaisFallback[chave] ?? CANAL_VAZIO
    muda('canaisFallback', { ...v.canaisFallback, [chave]: { ...atual, ...parcial } })
  }

  async function onSalvar(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setErro(null)
    setSucesso(null)

    // Conveniência: o servidor revalida tudo, inclusive as chaves do cérebro
    try {
      JSON.parse(v.cerebro)
    } catch (err) {
      setErro(`Cérebro não é um JSON válido. ${err instanceof Error ? err.message : ''}`)
      return
    }

    if (!novo) {
      const ok = window.confirm(
        `Salvar o cadastro de "${v.nomeNegocio}"?\nMudanças no cérebro mudam o comportamento do bot.`,
      )
      if (!ok) return
    }

    setLoading(true)
    try {
      const res = await fetch(novo ? '/api/admin/clientes' : `/api/admin/clientes/${id}`, {
        method: novo ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(v),
      })
      const data = (await res.json().catch(() => ({}))) as {
        id?: string
        message?: string
        error?: string
      }
      if (!res.ok) {
        setErro(data.message || data.error || 'Falha ao salvar.')
        return
      }
      if (novo) {
        router.push('/admin/clientes')
        router.refresh()
        return
      }
      setSucesso('Cadastro salvo.')
      router.refresh()
    } catch {
      setErro('Erro de rede.')
    } finally {
      setLoading(false)
    }
  }

  async function onAtivar() {
    if (loading || !id) return
    const ok = window.confirm(
      `Ativar "${v.nomeNegocio}"?\nO bot passa a responder no WhatsApp do número cadastrado.`,
    )
    if (!ok) return
    setLoading(true)
    setErro(null)
    setSucesso(null)
    try {
      const res = await fetch(`/api/admin/clientes/${id}/ativar`, { method: 'POST' })
      const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string }
      if (!res.ok) {
        setErro(data.message || data.error || 'Falha ao ativar.')
        return
      }
      setSucesso('Cliente ativado.')
      router.refresh()
    } catch {
      setErro('Erro de rede.')
    } finally {
      setLoading(false)
    }
  }

  const principal = v.canaisFallback.principal ?? CANAL_VAZIO

  return (
    <form className="cadastro" onSubmit={onSalvar}>
      <section className="card cadastro-secao">
        <h2>Negócio</h2>
        <div className="field">
          <label htmlFor="nomeNegocio">Nome do negócio</label>
          <input
            id="nomeNegocio"
            type="text"
            value={v.nomeNegocio}
            onChange={(e) => muda('nomeNegocio', e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="modo">Modo</label>
          <select id="modo" value={v.modo} onChange={(e) => muda('modo', e.target.value)}>
            <option value="">Escolha…</option>
            {MODOS.map((m) => (
              <option key={m.valor} value={m.valor}>
                {m.rotulo}
              </option>
            ))}
          </select>
          <p className="muted dica">Como o assistente guia a conversa. Passa a valer no atendimento na T12.</p>
        </div>
      </section>

      <section className="card cadastro-secao">
        <h2>Cérebro</h2>
        <p className="muted dica">
          JSON com o que é específico do cliente. Só os nomes das chaves são conferidos: chave
          desconhecida é recusada.
        </p>
        <textarea
          className="cerebro-edit"
          value={v.cerebro}
          onChange={(e) => muda('cerebro', e.target.value)}
          spellCheck={false}
          aria-label="Cérebro (JSON)"
        />
      </section>

      <section className="card cadastro-secao">
        <h2>Campos do pedido</h2>
        <p className="muted dica">
          O que o assistente precisa coletar para encaminhar, na ordem do e-mail. Ex.: nome, número
          de pessoas, data, horário.
        </p>
        {v.camposPedido.length === 0 ? <p className="muted">Nenhum campo ainda.</p> : null}
        {v.camposPedido.map((c, i) => (
          <div className="linha-campo" key={i}>
            <input
              type="text"
              value={c.nome}
              placeholder="Nome do campo"
              aria-label={`Campo ${i + 1}`}
              onChange={(e) => mudaCampoPedido(i, { nome: e.target.value })}
            />
            <label className="check">
              <input
                type="checkbox"
                checked={c.obrigatorio}
                onChange={(e) => mudaCampoPedido(i, { obrigatorio: e.target.checked })}
              />
              Obrigatório
            </label>
            <button type="button" className="btn-secondary btn-mini" onClick={() => moveCampoPedido(i, -1)} aria-label="Subir">
              ↑
            </button>
            <button type="button" className="btn-secondary btn-mini" onClick={() => moveCampoPedido(i, 1)} aria-label="Descer">
              ↓
            </button>
            <button
              type="button"
              className="btn-secondary btn-mini"
              onClick={() => muda('camposPedido', v.camposPedido.filter((_, j) => j !== i))}
            >
              Remover
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn-secondary"
          onClick={() => muda('camposPedido', [...v.camposPedido, { nome: '', obrigatorio: true }])}
        >
          + Adicionar campo
        </button>
      </section>

      <section className="card cadastro-secao">
        <h2>Encaminhamento</h2>
        <div className="field">
          <label htmlFor="emailPrestador">E-mail que recebe os encaminhamentos</label>
          <input
            id="emailPrestador"
            type="text"
            inputMode="email"
            value={v.emailPrestador}
            onChange={(e) => muda('emailPrestador', e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="nomeRemetente">Remetente do e-mail</label>
          <input
            id="nomeRemetente"
            type="text"
            value={v.nomeRemetente}
            placeholder={remetentePadrao(v.nomeNegocio || '[nome do negócio]')}
            onChange={(e) => muda('nomeRemetente', e.target.value)}
          />
          <p className="muted dica">Vazio = &quot;{remetentePadrao(v.nomeNegocio || '[nome do negócio]')}&quot;. Passa a valer na T10.</p>
        </div>
        <div className="field">
          <label htmlFor="destino">Destino do encaminhamento</label>
          <select
            id="destino"
            value={v.destinoEncaminhamento}
            onChange={(e) => muda('destinoEncaminhamento', e.target.value)}
          >
            {DESTINOS.map((d) => (
              <option key={d.valor} value={d.valor}>
                {d.rotulo}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="card cadastro-secao">
        <h2>Canais de fallback</h2>
        <p className="muted dica">
          Para onde o assistente aponta a pessoa quando o assunto não é com ele. O principal é
          obrigatório; os outros, só se o cliente tiver. Passa a valer na T12.
        </p>
        <LinhaCanal
          rotulo="Principal (obrigatório)"
          canal={principal}
          onChange={(p) => mudaCanal('principal', p)}
        />
        {CANAIS_DESVIO.map((c) => (
          <LinhaCanal
            key={c.chave}
            rotulo={c.rotulo}
            canal={v.canaisFallback[c.chave] ?? CANAL_VAZIO}
            onChange={(p) => mudaCanal(c.chave, p)}
          />
        ))}
      </section>

      <section className="card cadastro-secao">
        <h2>WhatsApp</h2>
        <p className="muted dica">Opcional. Preenchido ao fechar a venda.</p>
        <div className="field">
          <label htmlFor="phoneNumberId">ID do número na Meta (phone_number_id)</label>
          <input
            id="phoneNumberId"
            type="text"
            value={v.phoneNumberId}
            onChange={(e) => muda('phoneNumberId', e.target.value)}
          />
          <p className="muted dica">É o que liga as mensagens recebidas a este cliente.</p>
        </div>
        <div className="field">
          <label htmlFor="wabaId">ID da conta do WhatsApp Business (opcional)</label>
          <input id="wabaId" type="text" value={v.wabaId} onChange={(e) => muda('wabaId', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="numeroExibicao">Número exibido</label>
          <input
            id="numeroExibicao"
            type="text"
            value={v.numeroExibicao}
            placeholder="+55 21 99999-9999"
            onChange={(e) => muda('numeroExibicao', e.target.value)}
          />
          <p className="muted dica">Aparece no topo do link de teste. Não é usado para enviar nada.</p>
        </div>
        {status === 'prospect' ? (
          <div className="ativar">
            <button
              type="button"
              className="btn-secondary"
              onClick={onAtivar}
              disabled={loading || !phoneNumberIdSalvo}
            >
              Ativar cliente
            </button>
            <p className="muted dica">
              {phoneNumberIdSalvo
                ? 'O bot passa a responder no WhatsApp deste número.'
                : 'Preencha e salve o ID do número na Meta para poder ativar.'}
            </p>
          </div>
        ) : null}
      </section>

      {erro ? <p className="error">{erro}</p> : null}
      {sucesso ? <p className="success">{sucesso}</p> : null}

      <div className="cerebro-actions">
        <button type="submit" disabled={loading}>
          {loading ? 'Salvando…' : novo ? 'Criar cliente' : 'Salvar cadastro'}
        </button>
      </div>
    </form>
  )
}

function LinhaCanal({
  rotulo,
  canal,
  onChange,
}: {
  rotulo: string
  canal: Canal
  onChange: (parcial: Partial<Canal>) => void
}) {
  return (
    <div className="linha-canal">
      <span className="linha-canal-rotulo">{rotulo}</span>
      <select value={canal.tipo} onChange={(e) => onChange({ tipo: e.target.value })} aria-label={`${rotulo}: tipo`}>
        {TIPOS_CANAL.map((t) => (
          <option key={t.valor} value={t.valor}>
            {t.rotulo}
          </option>
        ))}
      </select>
      <input
        type="text"
        value={canal.contato}
        placeholder="Contato"
        aria-label={`${rotulo}: contato`}
        onChange={(e) => onChange({ contato: e.target.value })}
      />
    </div>
  )
}
