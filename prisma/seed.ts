import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import bcrypt from 'bcryptjs'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('🌱 Iniciando seed de demonstração...')

  // ── 1. Usuário demo ──────────────────────────────────────────────────────────
  const email = 'demo@pergunteaoseucontador.com.br'
  const existing = await prisma.user.findUnique({ where: { email } })

  if (existing) {
    console.log(`  ℹ️  Usuário demo já existe (${email}) — pulando criação.`)
    return
  }

  const passwordHash = await bcrypt.hash('demo12345', 12)
  const user = await prisma.user.create({
    data: {
      email,
      name: 'Usuário Demo',
      passwordHash,
    },
  })
  console.log(`  ✅ Usuário criado: ${user.email}`)

  // ── 2. Conversa 1 — dúvida CLT ──────────────────────────────────────────────
  const conv1 = await prisma.conversation.create({
    data: {
      userId: user.id,
      title: 'Como declarar investimentos em FII?',
      messages: {
        create: [
          {
            role: 'USER',
            content: { text: 'Tenho FIIs e recebi dividendos este ano. Preciso declarar?' },
          },
          {
            role: 'ASSISTANT',
            content: {
              paragraphs: [
                'Sim, dividendos de FIIs precisam ser declarados mesmo sendo isentos de IR.',
                'Na declaração, eles entram como "Rendimentos Isentos e Não Tributáveis", item 09.',
              ],
              checklist: [
                'Informe o CNPJ do fundo na ficha de Bens e Direitos',
                'Lance os dividendos em Rendimentos Isentos — código 09',
                'O valor base é o que consta no informe de rendimentos da corretora',
              ],
              steps: null,
              suggestBook: false,
              bookReason: null,
            },
          },
        ],
      },
    },
  })
  console.log(`  ✅ Conversa 1 criada: "${conv1.title}"`)

  // ── 3. Conversa 2 — MEI + PF ────────────────────────────────────────────────
  const conv2 = await prisma.conversation.create({
    data: {
      userId: user.id,
      title: 'MEI e renda PF no mesmo ano — como declarar?',
      messages: {
        create: [
          {
            role: 'USER',
            content: { text: 'Sou MEI e também tenho salário CLT. Como fica minha declaração?' },
          },
          {
            role: 'ASSISTANT',
            content: {
              paragraphs: [
                'Você declara tudo na mesma declaração de Pessoa Física — o MEI não exige IRPJ separado se estiver no Simples.',
                'O salário CLT entra normalmente pelo informe do empregador. O lucro do MEI entra como rendimento isento (até o limite legal).',
              ],
              checklist: null,
              steps: [
                {
                  title: 'Rendimento CLT',
                  description: 'Importe o informe de rendimentos do empregador na ficha "Rendimentos Tributáveis Recebidos de PJ".',
                },
                {
                  title: 'Lucro MEI',
                  description: 'Calcule o lucro presumido isento (comércio: 8%, serviços: 32% do faturamento) e lance em "Rendimentos Isentos".',
                },
                {
                  title: 'Faturamento acima do limite',
                  description: 'Se faturou acima de R$ 81 mil, parte do lucro pode ser tributável — vale consultar um contador.',
                },
              ],
              suggestBook: true,
              bookReason: 'A combinação MEI + CLT tem detalhes que variam por faturamento. Uma sessão de 1h esclarece sua situação específica.',
            },
          },
        ],
      },
    },
  })
  console.log(`  ✅ Conversa 2 criada: "${conv2.title}"`)

  // ── 4. Booking de demonstração ───────────────────────────────────────────────
  const scheduledAt = new Date()
  scheduledAt.setDate(scheduledAt.getDate() + 7) // 1 semana a partir de hoje
  scheduledAt.setHours(10, 0, 0, 0)

  const payment = await prisma.payment.create({
    data: {
      userId: user.id,
      amountCents: 19700,
      status: 'PAID',
      externalId: 'mock-payment-seed-001',
    },
  })

  const booking = await prisma.booking.create({
    data: {
      userId: user.id,
      scheduledAt,
      status: 'CONFIRMED',
      externalId: 'mock-cal-seed-001',
      meetUrl: 'https://meet.google.com/mock-demo-seed',
      payments: { connect: { id: payment.id } },
    },
  })
  console.log(`  ✅ Booking demo criado: ${booking.id} — ${scheduledAt.toLocaleDateString('pt-BR')}`)

  console.log('\n✅ Seed concluído.')
  console.log(`\n   E-mail:  ${email}`)
  console.log('   Senha:   demo12345\n')
}

main()
  .catch((e) => {
    console.error('❌ Erro no seed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
