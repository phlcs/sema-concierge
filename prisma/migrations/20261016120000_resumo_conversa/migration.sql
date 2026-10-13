-- T11: resumo das mensagens que saíram da janela de histórico. Só acrescenta
-- colunas (vazias) e uma tabela nova; nada é apagado nem convertido.
ALTER TABLE "WhatsappConversation" ADD COLUMN "resumo" TEXT,
ADD COLUMN "resumoAte" TIMESTAMP(3);

CREATE TABLE "DemoResumo" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "sessaoId" TEXT NOT NULL,
    "resumo" TEXT NOT NULL,
    "resumoAte" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DemoResumo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DemoResumo_clienteId_sessaoId_key" ON "DemoResumo"("clienteId", "sessaoId");

ALTER TABLE "DemoResumo" ADD CONSTRAINT "DemoResumo_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;
