-- Telegram messages to the owner (daily report, morning digest, alerts), queued until sent.

-- CreateEnum
CREATE TYPE "NotifyKind" AS ENUM ('DAILY', 'MORNING', 'ALERT');

-- CreateTable
CREATE TABLE "telegram_messages" (
    "id" SERIAL NOT NULL,
    "kind" "NotifyKind" NOT NULL,
    "text" TEXT NOT NULL,
    "dedupe_key" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ,

    CONSTRAINT "telegram_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "telegram_messages_dedupe_key_key" ON "telegram_messages"("dedupe_key");

-- CreateIndex
CREATE INDEX "telegram_messages_sent_at_id_idx" ON "telegram_messages"("sent_at", "id");

