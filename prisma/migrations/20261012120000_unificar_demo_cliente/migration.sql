-- T7: unificação de demo e cliente.
-- Cada Demo vira um Cliente "prospect" (mesmo id, mesmo cérebro, mesmo link).
-- As mensagens do link de teste passam a apontar para o Cliente.
-- A tabela "Demo" NÃO é apagada: fica como cópia de segurança, sem uso no código.
BEGIN;

-- 1. Cliente: número de WhatsApp opcional e campos do link de teste
ALTER TABLE "Cliente" ALTER COLUMN "phoneNumberId" DROP NOT NULL;
ALTER TABLE "Cliente" ALTER COLUMN "whatsappToken" DROP NOT NULL;
ALTER TABLE "Cliente"
    ADD COLUMN "testeToken" TEXT NOT NULL DEFAULT (md5((random())::text) || md5((random())::text)),
    ADD COLUMN "testeLiberadoAte" TIMESTAMP(3),
    ADD COLUMN "testeLiberadoEm" TIMESTAMP(3),
    ADD COLUMN "testeLimiteMensagens" INTEGER NOT NULL DEFAULT 300,
    ADD COLUMN "numeroExibicao" TEXT;
CREATE UNIQUE INDEX "Cliente_testeToken_key" ON "Cliente"("testeToken");

-- 2. Demo -> Cliente prospect. O token da demo vira o token do link de teste,
-- então os links já enviados continuam valendo até a mesma data.
INSERT INTO "Cliente" (
    "id", "nomeNegocio", "phoneNumberId", "wabaId", "whatsappToken", "emailPrestador",
    "cerebro", "status", "testeToken", "testeLiberadoAte", "testeLiberadoEm",
    "testeLimiteMensagens", "numeroExibicao", "createdAt", "updatedAt"
)
SELECT
    d."id", d."nomeNegocio", NULL, NULL, NULL, d."emailExibicao",
    d."cerebro", 'prospect', d."token",
    CASE WHEN d."status" = 'ativo' THEN d."expiraEm" ELSE NULL END,
    d."createdAt",
    d."limiteMensagens", d."numeroExibicao", d."createdAt", CURRENT_TIMESTAMP
FROM "Demo" d;

-- 3. DemoMensagem aponta para o Cliente; demoId fica só como histórico
ALTER TABLE "DemoMensagem" DROP CONSTRAINT "DemoMensagem_demoId_fkey";
ALTER TABLE "DemoMensagem" ALTER COLUMN "demoId" DROP NOT NULL;
ALTER TABLE "DemoMensagem" ADD COLUMN "clienteId" TEXT;
UPDATE "DemoMensagem" SET "clienteId" = "demoId";
ALTER TABLE "DemoMensagem" ALTER COLUMN "clienteId" SET NOT NULL;
ALTER TABLE "DemoMensagem" ADD CONSTRAINT "DemoMensagem_clienteId_fkey"
    FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP INDEX "DemoMensagem_demoId_sessaoId_createdAt_idx";
CREATE INDEX "DemoMensagem_clienteId_sessaoId_createdAt_idx"
    ON "DemoMensagem"("clienteId", "sessaoId", "createdAt");

-- 4. Remove o cliente "Teste" que o instrumentation.ts criava a cada inicialização
-- (as conversas dele saem junto, em cascata)
DELETE FROM "Cliente" WHERE "phoneNumberId" = '000000000000000' AND "nomeNegocio" = 'Teste';

COMMIT;
