import Link from 'next/link'
import { redirect } from 'next/navigation'
import { isAdminAuthed } from '@/lib/admin/guard'
import { CHAVES_CEREBRO } from '@/lib/cerebro/chaves'
import LogoutButton from '../../LogoutButton'
import CadastroForm from '../CadastroForm'

export const dynamic = 'force-dynamic'

// Cérebro inicial: todas as chaves válidas, vazias, para preencher
const CEREBRO_MODELO = JSON.stringify(
  Object.fromEntries(CHAVES_CEREBRO.map((k) => [k, ''])),
  null,
  2,
)

export default async function NovoClientePage() {
  if (!(await isAdminAuthed())) {
    redirect('/admin/login')
  }

  return (
    <>
      <div className="topbar">
        <span className="brand">
          <Link href="/admin">Painel Sema</Link>
        </span>
        <LogoutButton />
      </div>
      <div className="shell">
        <p className="muted breadcrumb">
          <Link href="/admin/clientes">← Voltar para clientes</Link>
        </p>
        <h1>Novo cliente</h1>
        <p className="muted breadcrumb">
          O cliente nasce como prospect, sem número. O link de teste é gerado ao criar e fica
          bloqueado até você liberar na lista de clientes.
        </p>
        <CadastroForm
          inicial={{
            nomeNegocio: '',
            cerebro: CEREBRO_MODELO,
            modo: '',
            camposPedido: [],
            emailPrestador: '',
            nomeRemetente: '',
            destinoEncaminhamento: 'email',
            canaisFallback: { principal: { tipo: 'email', contato: '' } },
            phoneNumberId: '',
            wabaId: '',
            numeroExibicao: '',
          }}
        />
      </div>
    </>
  )
}
