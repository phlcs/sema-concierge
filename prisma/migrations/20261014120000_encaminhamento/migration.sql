-- T9: encaminhamentos registrados pela ferramenta. Só cria a tabela; nada é apagado.
CREATE TABLE "Encaminhamento" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "conversaId" TEXT,
    "sessaoId" TEXT,
    "campos" JSONB NOT NULL,
    "intencao" TEXT,
    "resumo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Encaminhamento_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Encaminhamento_conversaId_createdAt_idx" ON "Encaminhamento"("conversaId", "createdAt");

CREATE INDEX "Encaminhamento_clienteId_sessaoId_createdAt_idx" ON "Encaminhamento"("clienteId", "sessaoId", "createdAt");

ALTER TABLE "Encaminhamento" ADD CONSTRAINT "Encaminhamento_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Encaminhamento" ADD CONSTRAINT "Encaminhamento_conversaId_fkey" FOREIGN KEY ("conversaId") REFERENCES "WhatsappConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
