-- AlterTable
ALTER TABLE "WhatsappConversation" ADD COLUMN     "ctwaClid" TEXT,
ADD COLUMN     "referral" JSONB,
ADD COLUMN     "referralEm" TIMESTAMP(3);

