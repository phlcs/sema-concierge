-- T10: tipo do encaminhamento (novo, atualização, cancelamento) e o que mudou.
-- Só acrescenta colunas; os registros que já existem viram "novo".
ALTER TABLE "Encaminhamento" ADD COLUMN "tipo" TEXT NOT NULL DEFAULT 'novo',
ADD COLUMN "mudou" TEXT;
