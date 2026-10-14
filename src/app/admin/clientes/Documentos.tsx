'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition, type FormEvent } from 'react'

export type DocumentoTela = {
  id: string
  nome: string
  arquivoNome: string
  tamanho: number
  status: string
  podeEnviar: boolean
}

const LIMITE_BYTES = 10 * 1024 * 1024

function tamanhoEmTexto(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
}

function statusEmTexto(status: string): string {
  if (status === 'pronto') return 'Pronto para busca'
  if (status === 'processando') return 'Processando…'
  return 'Falha: não dá para buscar (PDF sem texto?)'
}

async function mensagemDeErro(res: Response, padrao: string): Promise<string> {
  try {
    const data = (await res.json()) as { message?: string; error?: string }
    return data.message || data.error || padrao
  } catch {
    return padrao
  }
}

// Documentos do cliente (T14): PDFs que a IA consulta e, se marcados, envia na conversa.
export default function Documentos({ clienteId, documentos }: { clienteId: string; documentos: DocumentoTela[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [carregando, setCarregando] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [sucesso, setSucesso] = useState<string | null>(null)
  const [nome, setNome] = useState('')
  const arquivoRef = useRef<HTMLInputElement>(null)

  const ocupado = carregando !== null || pending
  const base = `/api/admin/clientes/${clienteId}/documentos`

  function atualizar() {
    startTransition(() => router.refresh())
  }

  async function subir(e: FormEvent) {
    e.preventDefault()
    setErro(null)
    setSucesso(null)
    const arquivo = arquivoRef.current?.files?.[0]
    if (!arquivo) return setErro('Escolha um PDF.')
    if (arquivo.size > LIMITE_BYTES) return setErro('O PDF passa de 10 MB.')
    const form = new FormData()
    form.append('arquivo', arquivo)
    form.append('nome', nome)
    setCarregando('upload')
    try {
      const res = await fetch(base, { method: 'POST', body: form })
      if (!res.ok) return setErro(await mensagemDeErro(res, 'Falha ao subir o documento.'))
      const data = (await res.json()) as { status?: string }
      setSucesso(
        data.status === 'pronto'
          ? 'Documento pronto para busca. Ele começa sem poder ser enviado.'
          : data.status === 'processando'
            ? 'Documento ainda processando. Recarregue a página em alguns minutos.'
            : 'O documento subiu, mas não ficou buscável. Confira se o PDF tem texto (não é imagem escaneada).',
      )
      setNome('')
      if (arquivoRef.current) arquivoRef.current.value = ''
      atualizar()
    } catch {
      setErro('Erro de rede.')
    } finally {
      setCarregando(null)
    }
  }

  async function marcarEnvio(doc: DocumentoTela) {
    setErro(null)
    setSucesso(null)
    setCarregando(doc.id)
    try {
      const res = await fetch(`${base}/${doc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ podeEnviar: !doc.podeEnviar }),
      })
      if (!res.ok) return setErro(await mensagemDeErro(res, 'Falha ao alterar o documento.'))
      atualizar()
    } catch {
      setErro('Erro de rede.')
    } finally {
      setCarregando(null)
    }
  }

  async function excluir(doc: DocumentoTela) {
    if (!window.confirm(`Excluir "${doc.nome}"? A IA deixa de consultar e de enviar este documento.`)) return
    setErro(null)
    setSucesso(null)
    setCarregando(doc.id)
    try {
      const res = await fetch(`${base}/${doc.id}`, { method: 'DELETE' })
      if (!res.ok) return setErro(await mensagemDeErro(res, 'Falha ao excluir o documento.'))
      atualizar()
    } catch {
      setErro('Erro de rede.')
    } finally {
      setCarregando(null)
    }
  }

  return (
    <section className="card cadastro-secao">
      <h2>Documentos</h2>
      <p className="muted dica">
        PDFs com texto (cardápio, manual, tabela), até 10 MB. A IA consulta todos os que estão
        prontos. Só envia na conversa os marcados como &quot;pode ser enviado&quot;. Os arquivos
        ficam guardados também na OpenAI.
      </p>

      {documentos.length === 0 ? <p className="muted">Nenhum documento ainda.</p> : null}
      {documentos.map((d) => (
        <div className="linha-documento" key={d.id}>
          <div className="documento-info">
            <strong>{d.nome}</strong>
            <span className="muted">
              {d.arquivoNome} · {tamanhoEmTexto(d.tamanho)} · {statusEmTexto(d.status)}
            </span>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={d.podeEnviar}
              disabled={ocupado || d.status !== 'pronto'}
              onChange={() => void marcarEnvio(d)}
            />
            Pode ser enviado
          </label>
          <button
            type="button"
            className="btn-secondary btn-mini"
            disabled={ocupado}
            onClick={() => void excluir(d)}
          >
            Excluir
          </button>
        </div>
      ))}

      <form className="upload-documento" onSubmit={subir}>
        <div className="field">
          <label htmlFor="documento-nome">Nome que a IA vê (opcional)</label>
          <input
            id="documento-nome"
            type="text"
            value={nome}
            maxLength={60}
            placeholder="Ex.: Cardápio. Vazio = nome do arquivo"
            onChange={(e) => setNome(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="documento-arquivo">Arquivo PDF</label>
          <input id="documento-arquivo" ref={arquivoRef} type="file" accept="application/pdf,.pdf" />
        </div>
        <button type="submit" className="btn-secondary" disabled={ocupado}>
          {carregando === 'upload' ? 'Subindo e preparando a busca…' : 'Subir documento'}
        </button>
      </form>

      {erro ? <p className="error">{erro}</p> : null}
      {sucesso ? <p className="success">{sucesso}</p> : null}
    </section>
  )
}
