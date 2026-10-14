-- T14: documentos do cliente. Só acrescenta uma coluna (vazia) e uma tabela nova;
-- nada é apagado nem convertido.
ALTER TABLE "Cliente" ADD COLUMN "vectorStoreId" TEXT;

CREATE TABLE "Documento" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "arquivoNome" TEXT NOT NULL,
    "tamanho" INTEGER NOT NULL,
    "conteudo" BYTEA NOT NULL,
    "openaiFileId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'processando',
    "podeEnviar" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Documento_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Documento_clienteId_nome_key" ON "Documento"("clienteId", "nome");

ALTER TABLE "Documento" ADD CONSTRAINT "Documento_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;
