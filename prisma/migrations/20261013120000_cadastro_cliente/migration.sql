-- T8: cadastro completo do cliente. Só acrescenta colunas; nada é apagado.
ALTER TABLE "Cliente"
    ADD COLUMN "modo" TEXT,
    ADD COLUMN "camposPedido" JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN "nomeRemetente" TEXT,
    ADD COLUMN "destinoEncaminhamento" TEXT NOT NULL DEFAULT 'email',
    ADD COLUMN "canaisFallback" JSONB NOT NULL DEFAULT '{}';
