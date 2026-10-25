-- Money received on the shop's bank account (SePay / Casso feeds), matched to orders by the order code.

-- CreateEnum
CREATE TYPE "BankProvider" AS ENUM ('SEPAY', 'CASSO');

-- CreateEnum
CREATE TYPE "MatchKind" AS ENUM ('CODE', 'AMOUNT', 'MANUAL');

-- CreateTable
CREATE TABLE "bank_transactions" (
    "id" SERIAL NOT NULL,
    "branch_id" INTEGER NOT NULL,
    "provider" "BankProvider" NOT NULL,
    "external_id" TEXT NOT NULL,
    "account_no" TEXT,
    "amount" DECIMAL(16,2) NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "bank_name" TEXT,
    "transacted_at" TIMESTAMPTZ NOT NULL,
    "business_date" DATE NOT NULL,
    "order_id" INTEGER,
    "match_kind" "MatchKind",
    "matched_by" INTEGER,
    "matched_at" TIMESTAMPTZ,
    "ignored_at" TIMESTAMPTZ,
    "ignored_by" INTEGER,
    "ignore_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_transactions_branch_id_business_date_idx" ON "bank_transactions"("branch_id", "business_date");

-- CreateIndex
CREATE INDEX "bank_transactions_order_id_idx" ON "bank_transactions"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transactions_provider_external_id_key" ON "bank_transactions"("provider", "external_id");

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

