-- Cash book, suppliers & payables, employees / shifts / attendance / payroll.

-- CreateEnum
CREATE TYPE "CashDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "PayType" AS ENUM ('HOURLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('DRAFT', 'CLOSED');

-- AlterTable
ALTER TABLE "receipts" ADD COLUMN     "supplier_id" INTEGER;

-- CreateTable
CREATE TABLE "cash_entries" (
    "id" SERIAL NOT NULL,
    "branch_id" INTEGER NOT NULL,
    "business_date" DATE NOT NULL,
    "direction" "CashDirection" NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "note" TEXT,
    "source" TEXT,
    "source_id" INTEGER,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMPTZ,
    "cancelled_by" INTEGER,
    "cancel_reason" TEXT,

    CONSTRAINT "cash_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payments" (
    "id" SERIAL NOT NULL,
    "branch_id" INTEGER NOT NULL,
    "supplier_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "method" TEXT NOT NULL,
    "receipt_id" INTEGER,
    "note" TEXT,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMPTZ,
    "cancelled_by" INTEGER,
    "cancel_reason" TEXT,

    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "position" TEXT,
    "pay_type" "PayType" NOT NULL DEFAULT 'HOURLY',
    "rate" DECIMAL(16,2) NOT NULL,
    "user_id" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "start" TEXT NOT NULL,
    "end" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance" (
    "id" SERIAL NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "shift_id" INTEGER,
    "check_in" TIMESTAMPTZ,
    "check_out" TIMESTAMPTZ,
    "note" TEXT,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payrolls" (
    "id" SERIAL NOT NULL,
    "branch_id" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "closed_at" TIMESTAMPTZ,
    "closed_by" INTEGER,
    "overhead_expense_id" INTEGER,

    CONSTRAINT "payrolls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_lines" (
    "id" SERIAL NOT NULL,
    "payroll_id" INTEGER NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "pay_type" "PayType" NOT NULL,
    "hours" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "rate" DECIMAL(16,2) NOT NULL,
    "base_pay" DECIMAL(16,2) NOT NULL,
    "bonus" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "deduction" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "advance" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "paid_at" TIMESTAMPTZ,

    CONSTRAINT "payroll_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cash_entries_branch_id_business_date_idx" ON "cash_entries"("branch_id", "business_date");

-- CreateIndex
CREATE INDEX "cash_entries_source_source_id_idx" ON "cash_entries"("source", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_name_key" ON "suppliers"("name");

-- CreateIndex
CREATE INDEX "supplier_payments_supplier_id_idx" ON "supplier_payments"("supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "employees_user_id_key" ON "employees"("user_id");

-- CreateIndex
CREATE INDEX "attendance_date_idx" ON "attendance"("date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_employee_id_date_key" ON "attendance"("employee_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "payrolls_branch_id_year_month_key" ON "payrolls"("branch_id", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_lines_payroll_id_employee_id_key" ON "payroll_lines"("payroll_id", "employee_id");

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_payroll_id_fkey" FOREIGN KEY ("payroll_id") REFERENCES "payrolls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Suppliers from the names already typed on purchase receipts, and link those receipts.
INSERT INTO "suppliers" ("name")
SELECT DISTINCT trim("supplier") FROM "receipts"
WHERE "kind" = 'PURCHASE' AND "supplier" IS NOT NULL AND trim("supplier") <> ''
ON CONFLICT ("name") DO NOTHING;

UPDATE "receipts" r SET "supplier_id" = s."id"
FROM "suppliers" s
WHERE r."kind" = 'PURCHASE' AND trim(r."supplier") = s."name";

-- Receipts entered before payables existed were paid at the time: one OPENING payment per supplier
-- settles them, so balances start at zero (no cash book entry: the money left long ago).
INSERT INTO "supplier_payments" ("branch_id", "supplier_id", "date", "amount", "method", "note", "created_by")
SELECT r."branch_id", r."supplier_id", CURRENT_DATE, SUM(i."amount"), 'OPENING',
       'Đã thanh toán trước khi dùng công nợ', MIN(r."created_by")
FROM "receipts" r JOIN "receipt_items" i ON i."receipt_id" = r."id"
WHERE r."supplier_id" IS NOT NULL
GROUP BY r."branch_id", r."supplier_id"
HAVING SUM(i."amount") > 0;
