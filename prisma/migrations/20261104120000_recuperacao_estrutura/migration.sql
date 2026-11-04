-- T02 · Lead Recovery: estrutura de dados.
-- Migração 100% aditiva: só cria tabelas, índices, restrições e um gatilho NOVOS.
-- Nenhuma tabela, coluna, índice ou linha existente é alterada ou apagada.
-- Nenhuma coluna é criada em Cliente ou WhatsappConversation (as FKs apontam para elas).
-- Parte 1: SQL gerado pelo Prisma (prisma migrate diff).
-- Parte 2 (final do arquivo): CHECKs, índice único parcial e gatilho, escritos à mão.

-- CreateTable
CREATE TABLE "RecuperacaoConfig" (
    "clienteId" TEXT NOT NULL,
    "modo" TEXT NOT NULL DEFAULT 'desligado',
    "ativadoEm" TIMESTAMP(3),
    "templateNome" TEXT,
    "templateIdioma" TEXT NOT NULL DEFAULT 'pt_BR',
    "templateCorpo" TEXT,
    "horaInicio" INTEGER NOT NULL DEFAULT 9,
    "horaFim" INTEGER NOT NULL DEFAULT 20,
    "diasSemana" INTEGER[] DEFAULT ARRAY[0, 1, 2, 3, 4, 5, 6]::INTEGER[],
    "descricaoNegocio" TEXT,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecuperacaoConfig_pkey" PRIMARY KEY ("clienteId")
);

-- CreateTable
CREATE TABLE "AtividadeContato" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "numeroContato" TEXT NOT NULL,
    "fromBruto" TEXT NOT NULL,
    "ultimaEntradaEm" TIMESTAMP(3) NOT NULL,
    "ultimaEntradaMetaTs" TIMESTAMP(3),
    "ultimoWamid" TEXT,
    "ultimoTipo" TEXT NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "AtividadeContato_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecuperacaoAvaliacao" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "numeroContato" TEXT NOT NULL,
    "conversaId" TEXT,
    "referenciaEm" TIMESTAMP(3) NOT NULL,
    "modo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "motivoRegra" TEXT,
    "decisao" TEXT,
    "motivo" TEXT,
    "evidencias" JSONB,
    "sinais" JSONB,
    "modelo" TEXT,
    "versaoPrompt" TEXT,
    "registroRespostaId" TEXT,
    "falhasIa" INTEGER NOT NULL DEFAULT 0,
    "revisadoEm" TIMESTAMP(3),
    "revisaoMotivo" TEXT,
    "corpoSimulado" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecuperacaoAvaliacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecuperacaoEnvio" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "numeroContato" TEXT NOT NULL,
    "conversaId" TEXT,
    "avaliacaoId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "templateNome" TEXT NOT NULL,
    "templateIdioma" TEXT NOT NULL,
    "corpo" TEXT NOT NULL,
    "wamid" TEXT,
    "tentativasMeta" INTEGER NOT NULL DEFAULT 0,
    "erroCodigo" INTEGER,
    "erroHttp" INTEGER,
    "erroTitulo" TEXT,
    "categoriaCobranca" TEXT,
    "conflitoAtividade" BOOLEAN NOT NULL DEFAULT false,
    "mensagemId" TEXT,
    "mensagemRemovidaEm" TIMESTAMP(3),
    "reivindicadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aceitoEm" TIMESTAMP(3),
    "entregueEm" TIMESTAMP(3),
    "lidoEm" TIMESTAMP(3),
    "falhouEm" TIMESTAMP(3),
    "incertoEm" TIMESTAMP(3),
    "respondidoEm" TIMESTAMP(3),
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecuperacaoEnvio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecuperacaoBloqueio" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "numeroContato" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "motivo" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecuperacaoBloqueio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AtividadeContato_clienteId_ultimaEntradaEm_idx" ON "AtividadeContato"("clienteId", "ultimaEntradaEm");

-- CreateIndex
CREATE UNIQUE INDEX "AtividadeContato_clienteId_numeroContato_key" ON "AtividadeContato"("clienteId", "numeroContato");

-- CreateIndex
CREATE INDEX "RecuperacaoAvaliacao_clienteId_status_criadoEm_idx" ON "RecuperacaoAvaliacao"("clienteId", "status", "criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "RecuperacaoAvaliacao_clienteId_numeroContato_referenciaEm_m_key" ON "RecuperacaoAvaliacao"("clienteId", "numeroContato", "referenciaEm", "modo");

-- CreateIndex
CREATE UNIQUE INDEX "RecuperacaoAvaliacao_id_clienteId_numeroContato_key" ON "RecuperacaoAvaliacao"("id", "clienteId", "numeroContato");

-- CreateIndex
CREATE UNIQUE INDEX "RecuperacaoEnvio_wamid_key" ON "RecuperacaoEnvio"("wamid");

-- CreateIndex
CREATE INDEX "RecuperacaoEnvio_clienteId_numeroContato_idx" ON "RecuperacaoEnvio"("clienteId", "numeroContato");

-- CreateIndex
CREATE INDEX "RecuperacaoEnvio_avaliacaoId_idx" ON "RecuperacaoEnvio"("avaliacaoId");

-- CreateIndex
CREATE INDEX "RecuperacaoEnvio_status_reivindicadoEm_idx" ON "RecuperacaoEnvio"("status", "reivindicadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "RecuperacaoBloqueio_clienteId_numeroContato_key" ON "RecuperacaoBloqueio"("clienteId", "numeroContato");

-- AddForeignKey
ALTER TABLE "RecuperacaoConfig" ADD CONSTRAINT "RecuperacaoConfig_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeContato" ADD CONSTRAINT "AtividadeContato_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecuperacaoAvaliacao" ADD CONSTRAINT "RecuperacaoAvaliacao_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecuperacaoEnvio" ADD CONSTRAINT "RecuperacaoEnvio_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecuperacaoEnvio" ADD CONSTRAINT "RecuperacaoEnvio_conversaId_fkey" FOREIGN KEY ("conversaId") REFERENCES "WhatsappConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecuperacaoEnvio" ADD CONSTRAINT "RecuperacaoEnvio_avaliacaoId_clienteId_numeroContato_fkey" FOREIGN KEY ("avaliacaoId", "clienteId", "numeroContato") REFERENCES "RecuperacaoAvaliacao"("id", "clienteId", "numeroContato") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecuperacaoBloqueio" ADD CONSTRAINT "RecuperacaoBloqueio_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ═════════════════════════════════════════════════════════════════════════════
-- Parte 2 — escrito à mão (o Prisma não declara CHECK, índice parcial nem gatilho)
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Domínios fechados (fail-closed: um valor com erro de digitação é recusado,
--    em vez de ocupar ou liberar a oportunidade por engano) ────────────────────

ALTER TABLE "RecuperacaoConfig"
  ADD CONSTRAINT "RecuperacaoConfig_modo_check"
    CHECK ("modo" IN ('desligado', 'simulacao', 'real')),
  ADD CONSTRAINT "RecuperacaoConfig_janela_check"
    CHECK ("horaInicio" BETWEEN 0 AND 23 AND "horaFim" BETWEEN 1 AND 24 AND "horaInicio" < "horaFim"),
  ADD CONSTRAINT "RecuperacaoConfig_diasSemana_check"
    CHECK ("diasSemana" IS NOT NULL AND cardinality("diasSemana") > 0 AND "diasSemana" <@ ARRAY[0, 1, 2, 3, 4, 5, 6]);

ALTER TABLE "AtividadeContato"
  ADD CONSTRAINT "AtividadeContato_numeroContato_check" CHECK ("numeroContato" ~ '^[0-9]+$'),
  ADD CONSTRAINT "AtividadeContato_versao_check" CHECK ("versao" >= 1);

ALTER TABLE "RecuperacaoAvaliacao"
  ADD CONSTRAINT "RecuperacaoAvaliacao_numeroContato_check" CHECK ("numeroContato" ~ '^[0-9]+$'),
  ADD CONSTRAINT "RecuperacaoAvaliacao_modo_check" CHECK ("modo" IN ('simulacao', 'real')),
  ADD CONSTRAINT "RecuperacaoAvaliacao_status_check" CHECK ("status" IN (
    'pendente', 'descartada_regra', 'classificada', 'erro', 'erro_definitivo',
    'cancelada_atividade', 'bloqueada_verificacao', 'aguardando_revisao',
    'aprovada', 'rejeitada', 'enviada', 'simulado_enviaria')),
  ADD CONSTRAINT "RecuperacaoAvaliacao_decisao_check"
    CHECK ("decisao" IS NULL OR "decisao" IN ('recuperar', 'nao_recuperar', 'incerto')),
  ADD CONSTRAINT "RecuperacaoAvaliacao_falhasIa_check" CHECK ("falhasIa" >= 0);

ALTER TABLE "RecuperacaoBloqueio"
  ADD CONSTRAINT "RecuperacaoBloqueio_numeroContato_check" CHECK ("numeroContato" ~ '^[0-9]+$');

ALTER TABLE "RecuperacaoEnvio"
  ADD CONSTRAINT "RecuperacaoEnvio_numeroContato_check" CHECK ("numeroContato" ~ '^[0-9]+$'),
  ADD CONSTRAINT "RecuperacaoEnvio_status_check" CHECK ("status" IN (
    'enviando', 'aceito', 'entregue', 'lido', 'falhou', 'incerto',
    'adiado', 'rejeitado', 'cancelado')),
  ADD CONSTRAINT "RecuperacaoEnvio_tentativasMeta_check" CHECK ("tentativasMeta" >= 0),
  -- Todo estado que implica contato com a Meta exige ao menos uma chamada registrada.
  -- É isto que torna "cancelado com tentativasMeta = 0" uma prova de que nada foi à Meta.
  ADD CONSTRAINT "RecuperacaoEnvio_contato_meta_check" CHECK (
    "tentativasMeta" >= 1
    OR ("status" IN ('enviando', 'cancelado') AND "wamid" IS NULL)
  );

-- ── Gatilho: tentativasMeta nunca diminui ───────────────────────────────────
-- Impede "zerar" uma linha que já falou com a Meta para cancelá-la e liberar a vaga.
CREATE FUNCTION "RecuperacaoEnvio_tentativasMeta_monotona"() RETURNS trigger AS $$
BEGIN
  IF NEW."tentativasMeta" < OLD."tentativasMeta" THEN
    RAISE EXCEPTION 'RecuperacaoEnvio.tentativasMeta nao pode diminuir (% -> %)',
      OLD."tentativasMeta", NEW."tentativasMeta"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "RecuperacaoEnvio_tentativasMeta_monotona"
  BEFORE UPDATE OF "tentativasMeta" ON "RecuperacaoEnvio"
  FOR EACH ROW EXECUTE FUNCTION "RecuperacaoEnvio_tentativasMeta_monotona"();

-- ── Unicidade da oportunidade de envio (regra de negócio, garantida pelo banco) ──
-- No máximo UMA linha que ocupa a oportunidade por (clienteId, numeroContato).
-- Liberam a vaga SOMENTE:
--   · 'rejeitado': rejeição definitiva comprovada pela Meta, sem aceite;
--   · 'cancelado' comprovadamente anterior a qualquer chamada à Meta
--     (tentativasMeta = 0, sem wamid, sem código de erro).
-- Ocupam a vaga (lista negativa, falha fechada): enviando, aceito, entregue, lido,
-- falhou, incerto, adiado e qualquer cancelado com chamada registrada.
-- A linha liberada fica como auditoria; a nova tentativa é uma nova linha.
CREATE UNIQUE INDEX "RecuperacaoEnvio_oportunidade_key"
  ON "RecuperacaoEnvio" ("clienteId", "numeroContato")
  WHERE NOT (
    "status" = 'rejeitado'
    OR ("status" = 'cancelado' AND "tentativasMeta" = 0
        AND "wamid" IS NULL AND "erroCodigo" IS NULL AND "erroHttp" IS NULL)
  );
