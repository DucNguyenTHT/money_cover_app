-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('PURCHASE', 'SALE', 'OTHER');

-- CreateTable
CREATE TABLE "documents" (
    "id" SERIAL NOT NULL,
    "branch_id" INTEGER NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "date" DATE NOT NULL,
    "number" TEXT,
    "partner" TEXT,
    "amount" DECIMAL(16,2),
    "note" TEXT,
    "receipt_id" INTEGER,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,
    "deleted_by" INTEGER,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_files" (
    "id" SERIAL NOT NULL,
    "document_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "thumb_path" TEXT,
    "sha256" TEXT NOT NULL,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "document_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "documents_branch_id_date_idx" ON "documents"("branch_id", "date");

-- CreateIndex
CREATE INDEX "documents_receipt_id_idx" ON "documents"("receipt_id");

-- CreateIndex
CREATE INDEX "document_files_document_id_idx" ON "document_files"("document_id");

-- CreateIndex
CREATE INDEX "document_files_sha256_idx" ON "document_files"("sha256");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
