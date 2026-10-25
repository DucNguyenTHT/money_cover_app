-- E-invoices (hoá đơn khởi tạo từ máy tính tiền) of paid orders, queued until the provider issues them.

-- CreateEnum
CREATE TYPE "EInvoiceProvider" AS ENUM ('MOCK', 'SEPAY');

-- CreateEnum
CREATE TYPE "EInvoiceStatus" AS ENUM ('PENDING', 'SENDING', 'ISSUED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EInvoiceKind" AS ENUM ('ORIGINAL', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "einvoices" (
    "id" SERIAL NOT NULL,
    "branch_id" INTEGER NOT NULL,
    "order_id" INTEGER NOT NULL,
    "kind" "EInvoiceKind" NOT NULL DEFAULT 'ORIGINAL',
    "provider" "EInvoiceProvider" NOT NULL,
    "status" "EInvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "reference_code" TEXT NOT NULL,
    "tracking_code" TEXT,
    "invoice_no" TEXT,
    "series" TEXT,
    "lookup_url" TEXT,
    "lookup_code" TEXT,
    "amount" DECIMAL(16,2) NOT NULL,
    "buyer" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issued_at" TIMESTAMPTZ,
    "original_id" INTEGER,
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "einvoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "einvoices_reference_code_key" ON "einvoices"("reference_code");

-- CreateIndex
CREATE INDEX "einvoices_status_next_attempt_at_idx" ON "einvoices"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "einvoices_order_id_idx" ON "einvoices"("order_id");

-- CreateIndex
CREATE INDEX "einvoices_branch_id_created_at_idx" ON "einvoices"("branch_id", "created_at");

-- AddForeignKey
ALTER TABLE "einvoices" ADD CONSTRAINT "einvoices_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

