-- CreateTable
CREATE TABLE "Evento" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tema" TEXT NOT NULL,
    "evento" TEXT NOT NULL,
    "gravidade" TEXT NOT NULL,
    "clienteId" TEXT,
    "detalhe" JSONB,

    CONSTRAINT "Evento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistroResposta" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "origem" TEXT NOT NULL,
    "funcao" TEXT NOT NULL,
    "clienteId" TEXT,
    "demoId" TEXT,
    "conversaId" TEXT,
    "provedor" TEXT NOT NULL,
    "modelo" TEXT NOT NULL,
    "versaoPrompt" TEXT,
    "tokensEntrada" INTEGER,
    "tokensSaida" INTEGER,
    "tokensCache" INTEGER,
    "tokensCacheEscrita" INTEGER,
    "tempoMs" INTEGER NOT NULL,
    "ferramentas" JSONB,
    "custoEstimadoUsd" DOUBLE PRECISION,
    "sucesso" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "RegistroResposta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterruptorGeral" (
    "id" TEXT NOT NULL,
    "ligado" BOOLEAN NOT NULL DEFAULT false,
    "ligadoEm" TIMESTAMP(3),
    "clientesIds" TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterruptorGeral_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Evento_createdAt_idx" ON "Evento"("createdAt");

-- CreateIndex
CREATE INDEX "Evento_tema_gravidade_createdAt_idx" ON "Evento"("tema", "gravidade", "createdAt");

-- CreateIndex
CREATE INDEX "Evento_clienteId_createdAt_idx" ON "Evento"("clienteId", "createdAt");

-- CreateIndex
CREATE INDEX "RegistroResposta_createdAt_idx" ON "RegistroResposta"("createdAt");

-- CreateIndex
CREATE INDEX "RegistroResposta_clienteId_createdAt_idx" ON "RegistroResposta"("clienteId", "createdAt");

-- CreateIndex
CREATE INDEX "RegistroResposta_origem_funcao_createdAt_idx" ON "RegistroResposta"("origem", "funcao", "createdAt");

