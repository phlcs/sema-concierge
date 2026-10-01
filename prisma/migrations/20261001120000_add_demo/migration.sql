-- CreateTable
CREATE TABLE "Demo" (
    "id" TEXT NOT NULL,
    "nomeNegocio" TEXT NOT NULL,
    "numeroExibicao" TEXT NOT NULL,
    "emailExibicao" TEXT NOT NULL,
    "cerebro" JSONB NOT NULL,
    "token" TEXT NOT NULL,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ativo',
    "limiteMensagens" INTEGER NOT NULL DEFAULT 300,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Demo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemoMensagem" (
    "id" TEXT NOT NULL,
    "demoId" TEXT NOT NULL,
    "sessaoId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "texto" TEXT NOT NULL,
    "handoff" BOOLEAN NOT NULL DEFAULT false,
    "leadNome" TEXT,
    "leadIntencao" TEXT,
    "leadResumo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemoMensagem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DemoMensagem_demoId_fkey" FOREIGN KEY ("demoId")
        REFERENCES "Demo"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Demo_token_key" ON "Demo"("token");

-- CreateIndex
CREATE INDEX "DemoMensagem_demoId_sessaoId_createdAt_idx"
    ON "DemoMensagem"("demoId", "sessaoId", "createdAt");
