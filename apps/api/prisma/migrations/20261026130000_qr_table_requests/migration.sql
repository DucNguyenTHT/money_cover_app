-- CreateEnum
CREATE TYPE "TableRequestKind" AS ENUM ('ORDER', 'CALL', 'BILL');

-- CreateEnum
CREATE TYPE "TableRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- AlterTable
ALTER TABLE "tables" ADD COLUMN     "qr_token" TEXT;

-- CreateTable
CREATE TABLE "table_requests" (
    "id" SERIAL NOT NULL,
    "branch_id" INTEGER NOT NULL,
    "table_id" INTEGER NOT NULL,
    "kind" "TableRequestKind" NOT NULL,
    "status" "TableRequestStatus" NOT NULL DEFAULT 'PENDING',
    "items" JSONB,
    "note" TEXT,
    "client_id" TEXT NOT NULL,
    "order_id" INTEGER,
    "handled_by" INTEGER,
    "handled_at" TIMESTAMPTZ,
    "reject_reason" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "table_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "table_requests_status_created_at_idx" ON "table_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "table_requests_table_id_status_idx" ON "table_requests"("table_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tables_qr_token_key" ON "tables"("qr_token");

-- AddForeignKey
ALTER TABLE "table_requests" ADD CONSTRAINT "table_requests_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "tables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

