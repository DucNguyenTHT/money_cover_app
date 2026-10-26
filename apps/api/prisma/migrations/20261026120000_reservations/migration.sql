-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('BOOKED', 'ARRIVED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "DepositOutcome" AS ENUM ('USED', 'REFUNDED', 'KEPT');

-- CreateTable
CREATE TABLE "reservations" (
    "id" SERIAL NOT NULL,
    "branch_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "customer_id" INTEGER,
    "guests" INTEGER NOT NULL,
    "reserved_at" TIMESTAMPTZ NOT NULL,
    "business_date" DATE NOT NULL,
    "duration_min" INTEGER NOT NULL DEFAULT 120,
    "table_id" INTEGER,
    "note" TEXT,
    "deposit" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "deposit_method" "PaymentMethod",
    "deposit_outcome" "DepositOutcome",
    "status" "ReservationStatus" NOT NULL DEFAULT 'BOOKED',
    "order_id" INTEGER,
    "cancel_reason" TEXT,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reservations_order_id_key" ON "reservations"("order_id");

-- CreateIndex
CREATE INDEX "reservations_branch_id_business_date_idx" ON "reservations"("branch_id", "business_date");

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
