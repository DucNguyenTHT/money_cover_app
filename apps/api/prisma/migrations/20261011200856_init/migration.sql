-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'STAFF', 'KITCHEN');

-- CreateEnum
CREATE TYPE "Station" AS ENUM ('KITCHEN', 'BAR');

-- CreateEnum
CREATE TYPE "IngredientKind" AS ENUM ('INGREDIENT', 'PACKAGING');

-- CreateEnum
CREATE TYPE "PriceType" AS ENUM ('STORE', 'APP');

-- CreateEnum
CREATE TYPE "RecipeScope" AS ENUM ('ALL', 'TAKEAWAY_APP');

-- CreateEnum
CREATE TYPE "PrinterRole" AS ENUM ('BILL', 'KITCHEN', 'BAR');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('DINE_IN', 'TAKEAWAY', 'APP');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('OPEN', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CancelKind" AS ENUM ('CANCELLED', 'MERGED');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'AMOUNT');

-- CreateEnum
CREATE TYPE "VatMode" AS ENUM ('EXCLUSIVE', 'INCLUSIVE');

-- CreateEnum
CREATE TYPE "KitchenStatus" AS ENUM ('NEW', 'SENT', 'DONE', 'SERVED');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'TRANSFER', 'CARD', 'APP');

-- CreateEnum
CREATE TYPE "ReceiptKind" AS ENUM ('PURCHASE', 'OPENING');

-- CreateEnum
CREATE TYPE "IssueReason" AS ENUM ('SALE_USE', 'DISPOSAL', 'SUPPLIER_RETURN', 'INTERNAL_USE');

-- CreateEnum
CREATE TYPE "StocktakeStatus" AS ENUM ('DRAFT', 'DONE', 'CANCELLED');

-- CreateTable
CREATE TABLE "branches" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "pin_hash" TEXT,
    "pin_failed_count" INTEGER NOT NULL DEFAULT 0,
    "pin_locked_until" TIMESTAMPTZ,
    "full_name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "station" "Station",
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingredients" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "IngredientKind" NOT NULL DEFAULT 'INGREDIENT',
    "unit" TEXT NOT NULL,
    "recipe_unit" TEXT NOT NULL,
    "recipe_factor" DECIMAL(16,4) NOT NULL DEFAULT 1,
    "purchase_unit" TEXT,
    "purchase_factor" DECIMAL(16,4) NOT NULL DEFAULT 1,
    "category" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dish_categories" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "food_cost_target" DECIMAL(5,2),
    "station" "Station" NOT NULL DEFAULT 'KITCHEN',
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "dish_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dishes" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category_id" INTEGER NOT NULL,
    "image_url" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sold_out_date" DATE,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "dishes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dish_prices" (
    "id" SERIAL NOT NULL,
    "dish_id" INTEGER NOT NULL,
    "price_type" "PriceType" NOT NULL,
    "price" DECIMAL(16,2) NOT NULL,
    "effective_from" DATE NOT NULL,
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dish_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dish_recipes" (
    "id" SERIAL NOT NULL,
    "dish_id" INTEGER NOT NULL,
    "effective_from" DATE NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dish_recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dish_recipe_items" (
    "id" SERIAL NOT NULL,
    "recipe_id" INTEGER NOT NULL,
    "ingredient_id" INTEGER NOT NULL,
    "qty" DECIMAL(16,4) NOT NULL,
    "scope" "RecipeScope" NOT NULL DEFAULT 'ALL',

    CONSTRAINT "dish_recipe_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "areas" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tables" (
    "id" SERIAL NOT NULL,
    "area_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "seats" INTEGER NOT NULL DEFAULT 4,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_apps" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "commission_pct" DECIMAL(5,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "delivery_apps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "printers" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 9100,
    "paper_width" INTEGER NOT NULL DEFAULT 80,
    "role" "PrinterRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "printers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "overhead_expenses" (
    "id" SERIAL NOT NULL,
    "branch_id" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "note" TEXT,

    CONSTRAINT "overhead_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "order_counters" (
    "branch_id" INTEGER NOT NULL,
    "business_date" DATE NOT NULL,
    "last_no" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "order_counters_pkey" PRIMARY KEY ("branch_id","business_date")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" SERIAL NOT NULL,
    "branch_id" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "business_date" DATE NOT NULL,
    "channel" "Channel" NOT NULL,
    "table_id" INTEGER,
    "delivery_app_id" INTEGER,
    "app_order_code" TEXT,
    "guest_count" INTEGER NOT NULL DEFAULT 1,
    "status" "OrderStatus" NOT NULL DEFAULT 'OPEN',
    "split_from_order_id" INTEGER,
    "subtotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "item_discount_total" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "order_discount_type" "DiscountType",
    "order_discount_value" DECIMAL(16,2),
    "order_discount_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "discount_reason" TEXT,
    "discount_approved_by" INTEGER,
    "service_charge_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "service_charge_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "net_revenue" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "vat_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "vat_mode" "VatMode" NOT NULL DEFAULT 'EXCLUSIVE',
    "vat_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "app_commission" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "cost_total" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "opened_by" INTEGER NOT NULL,
    "opened_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_by" INTEGER,
    "paid_at" TIMESTAMPTZ,
    "cancelled_by" INTEGER,
    "cancelled_at" TIMESTAMPTZ,
    "cancel_kind" "CancelKind",
    "cancel_reason" TEXT,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "dish_id" INTEGER NOT NULL,
    "recipe_id" INTEGER,
    "station" "Station" NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_price" DECIMAL(16,2) NOT NULL,
    "discount_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "discount_reason" TEXT,
    "amount" DECIMAL(16,2) NOT NULL,
    "net_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "cost_total" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "kitchen_status" "KitchenStatus" NOT NULL DEFAULT 'NEW',
    "kitchen_batch" INTEGER,
    "sent_at" TIMESTAMPTZ,
    "done_at" TIMESTAMPTZ,
    "served_at" TIMESTAMPTZ,
    "status" "ItemStatus" NOT NULL DEFAULT 'ACTIVE',
    "cancel_reason" TEXT,
    "cancelled_by" INTEGER,
    "cancelled_at" TIMESTAMPTZ,
    "wasted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_payments" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "cash_received" DECIMAL(16,2),
    "change" DECIMAL(16,2),

    CONSTRAINT "order_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "day_closings" (
    "id" SERIAL NOT NULL,
    "branch_id" INTEGER NOT NULL,
    "business_date" DATE NOT NULL,
    "expected_cash" DECIMAL(16,2) NOT NULL,
    "counted_cash" DECIMAL(16,2) NOT NULL,
    "diff" DECIMAL(16,2) NOT NULL,
    "expected_by_method" JSONB NOT NULL,
    "note" TEXT,
    "needs_reclose" BOOLEAN NOT NULL DEFAULT false,
    "closed_by" INTEGER NOT NULL,
    "closed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "day_closings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" SERIAL NOT NULL,
    "branch_id" INTEGER NOT NULL,
    "kind" "ReceiptKind" NOT NULL DEFAULT 'PURCHASE',
    "date" DATE NOT NULL,
    "supplier" TEXT,
    "note" TEXT,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_items" (
    "id" SERIAL NOT NULL,
    "receipt_id" INTEGER NOT NULL,
    "ingredient_id" INTEGER NOT NULL,
    "qty" DECIMAL(16,4) NOT NULL,
    "unit_price" DECIMAL(16,4) NOT NULL,
    "purchase_unit_qty" DECIMAL(16,4),
    "amount" DECIMAL(16,2) NOT NULL,

    CONSTRAINT "receipt_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lots" (
    "id" SERIAL NOT NULL,
    "branch_id" INTEGER NOT NULL,
    "ingredient_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "unit_price" DECIMAL(16,4) NOT NULL,
    "qty_in" DECIMAL(16,4) NOT NULL,
    "qty_remaining" DECIMAL(16,4) NOT NULL,
    "receipt_item_id" INTEGER,
    "stocktake_item_id" INTEGER,

    CONSTRAINT "lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issues" (
    "id" SERIAL NOT NULL,
    "branch_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "reason" "IssueReason" NOT NULL,
    "order_id" INTEGER,
    "order_item_id" INTEGER,
    "note" TEXT,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issue_items" (
    "id" SERIAL NOT NULL,
    "issue_id" INTEGER NOT NULL,
    "ingredient_id" INTEGER NOT NULL,
    "qty" DECIMAL(16,4) NOT NULL,
    "cost_total" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "pending_qty" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "pending_unit_price" DECIMAL(16,4),
    "lot_id" INTEGER,

    CONSTRAINT "issue_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issue_allocations" (
    "id" SERIAL NOT NULL,
    "issue_item_id" INTEGER NOT NULL,
    "lot_id" INTEGER NOT NULL,
    "qty" DECIMAL(16,4) NOT NULL,
    "unit_price" DECIMAL(16,4) NOT NULL,

    CONSTRAINT "issue_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stocktakes" (
    "id" SERIAL NOT NULL,
    "branch_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "status" "StocktakeStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_by" INTEGER,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "stocktakes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stocktake_items" (
    "id" SERIAL NOT NULL,
    "stocktake_id" INTEGER NOT NULL,
    "ingredient_id" INTEGER NOT NULL,
    "book_qty" DECIMAL(16,4) NOT NULL,
    "actual_qty" DECIMAL(16,4),
    "diff_qty" DECIMAL(16,4),
    "surplus_unit_price" DECIMAL(16,4),
    "loss_value" DECIMAL(16,2) NOT NULL DEFAULT 0,

    CONSTRAINT "stocktake_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stocktake_allocations" (
    "id" SERIAL NOT NULL,
    "stocktake_item_id" INTEGER NOT NULL,
    "lot_id" INTEGER NOT NULL,
    "qty" DECIMAL(16,4) NOT NULL,
    "unit_price" DECIMAL(16,4) NOT NULL,

    CONSTRAINT "stocktake_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stocktake_dish_allocations" (
    "id" SERIAL NOT NULL,
    "stocktake_item_id" INTEGER NOT NULL,
    "dish_id" INTEGER,
    "usage_qty" DECIMAL(16,4) NOT NULL,
    "value" DECIMAL(16,2) NOT NULL,

    CONSTRAINT "stocktake_dish_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "before" JSONB,
    "after" JSONB,
    "user_id" INTEGER,
    "approved_by" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "period_locks" (
    "id" SERIAL NOT NULL,
    "branch_id" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "locked_by" INTEGER NOT NULL,
    "locked_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "period_locks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monthly_closings" (
    "id" SERIAL NOT NULL,
    "branch_id" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "figures" JSONB NOT NULL,
    "dish_profit" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monthly_closings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "branches_code_key" ON "branches"("code");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "ingredients_code_key" ON "ingredients"("code");

-- CreateIndex
CREATE UNIQUE INDEX "dishes_code_key" ON "dishes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "dish_prices_dish_id_price_type_effective_from_key" ON "dish_prices"("dish_id", "price_type", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "dish_recipes_dish_id_effective_from_key" ON "dish_recipes"("dish_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "dish_recipe_items_recipe_id_ingredient_id_scope_key" ON "dish_recipe_items"("recipe_id", "ingredient_id", "scope");

-- CreateIndex
CREATE INDEX "overhead_expenses_branch_id_year_month_idx" ON "overhead_expenses"("branch_id", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "orders_code_key" ON "orders"("code");

-- CreateIndex
CREATE INDEX "orders_business_date_status_idx" ON "orders"("business_date", "status");

-- CreateIndex
CREATE INDEX "orders_table_id_status_idx" ON "orders"("table_id", "status");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_items_station_kitchen_status_idx" ON "order_items"("station", "kitchen_status");

-- CreateIndex
CREATE UNIQUE INDEX "day_closings_branch_id_business_date_key" ON "day_closings"("branch_id", "business_date");

-- CreateIndex
CREATE INDEX "receipts_branch_id_date_idx" ON "receipts"("branch_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "lots_receipt_item_id_key" ON "lots"("receipt_item_id");

-- CreateIndex
CREATE INDEX "lots_branch_id_ingredient_id_date_idx" ON "lots"("branch_id", "ingredient_id", "date");

-- CreateIndex
CREATE INDEX "issues_branch_id_date_reason_idx" ON "issues"("branch_id", "date", "reason");

-- CreateIndex
CREATE INDEX "issue_items_ingredient_id_pending_qty_idx" ON "issue_items"("ingredient_id", "pending_qty");

-- CreateIndex
CREATE UNIQUE INDEX "stocktake_items_stocktake_id_ingredient_id_key" ON "stocktake_items"("stocktake_id", "ingredient_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entity_id_idx" ON "audit_logs"("entity", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "period_locks_branch_id_year_month_key" ON "period_locks"("branch_id", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "monthly_closings_branch_id_year_month_key" ON "monthly_closings"("branch_id", "year", "month");

-- AddForeignKey
ALTER TABLE "dishes" ADD CONSTRAINT "dishes_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "dish_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dish_prices" ADD CONSTRAINT "dish_prices_dish_id_fkey" FOREIGN KEY ("dish_id") REFERENCES "dishes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dish_recipes" ADD CONSTRAINT "dish_recipes_dish_id_fkey" FOREIGN KEY ("dish_id") REFERENCES "dishes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dish_recipe_items" ADD CONSTRAINT "dish_recipe_items_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "dish_recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dish_recipe_items" ADD CONSTRAINT "dish_recipe_items_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tables" ADD CONSTRAINT "tables_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_app_id_fkey" FOREIGN KEY ("delivery_app_id") REFERENCES "delivery_apps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_dish_id_fkey" FOREIGN KEY ("dish_id") REFERENCES "dishes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "dish_recipes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_items" ADD CONSTRAINT "receipt_items_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_items" ADD CONSTRAINT "receipt_items_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_receipt_item_id_fkey" FOREIGN KEY ("receipt_item_id") REFERENCES "receipt_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_stocktake_item_id_fkey" FOREIGN KEY ("stocktake_item_id") REFERENCES "stocktake_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_items" ADD CONSTRAINT "issue_items_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_items" ADD CONSTRAINT "issue_items_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_allocations" ADD CONSTRAINT "issue_allocations_issue_item_id_fkey" FOREIGN KEY ("issue_item_id") REFERENCES "issue_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_allocations" ADD CONSTRAINT "issue_allocations_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktake_items" ADD CONSTRAINT "stocktake_items_stocktake_id_fkey" FOREIGN KEY ("stocktake_id") REFERENCES "stocktakes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktake_items" ADD CONSTRAINT "stocktake_items_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktake_allocations" ADD CONSTRAINT "stocktake_allocations_stocktake_item_id_fkey" FOREIGN KEY ("stocktake_item_id") REFERENCES "stocktake_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktake_allocations" ADD CONSTRAINT "stocktake_allocations_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktake_dish_allocations" ADD CONSTRAINT "stocktake_dish_allocations_stocktake_item_id_fkey" FOREIGN KEY ("stocktake_item_id") REFERENCES "stocktake_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktake_dish_allocations" ADD CONSTRAINT "stocktake_dish_allocations_dish_id_fkey" FOREIGN KEY ("dish_id") REFERENCES "dishes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
