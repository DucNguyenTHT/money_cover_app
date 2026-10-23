-- Salary advances (tạm ứng lương) and how a payroll line was paid.

-- AlterTable
ALTER TABLE "payroll_lines" ADD COLUMN     "paid_method" TEXT;

-- CreateTable
CREATE TABLE "salary_advances" (
    "id" SERIAL NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "method" TEXT NOT NULL,
    "note" TEXT,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMPTZ,
    "cancelled_by" INTEGER,
    "cancel_reason" TEXT,

    CONSTRAINT "salary_advances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "salary_advances_employee_id_date_idx" ON "salary_advances"("employee_id", "date");

-- AddForeignKey
ALTER TABLE "salary_advances" ADD CONSTRAINT "salary_advances_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
