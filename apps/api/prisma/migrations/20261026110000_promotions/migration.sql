-- CreateEnum
CREATE TYPE "PromotionKind" AS ENUM ('TIME', 'COMBO');

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "promo_discount" DECIMAL(16,2) NOT NULL DEFAULT 0,
ADD COLUMN     "promotion_id" INTEGER;

-- Existing lines: ordered when their order was opened.
UPDATE "order_items" i SET "created_at" = o."opened_at" FROM "orders" o WHERE o."id" = i."order_id";

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "promo_discount_total" DECIMAL(16,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "promotions" (
    "id" SERIAL NOT NULL,
    "branch_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PromotionKind" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "start_date" DATE,
    "end_date" DATE,
    "weekdays" INTEGER[],
    "start_time" TEXT,
    "end_time" TEXT,
    "channels" "Channel"[],
    "percent" DECIMAL(5,2),
    "combo_price" DECIMAL(16,2),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_items" (
    "id" SERIAL NOT NULL,
    "promotion_id" INTEGER NOT NULL,
    "dish_id" INTEGER,
    "category_id" INTEGER,
    "qty" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "promotion_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "promotion_items_promotion_id_idx" ON "promotion_items"("promotion_id");

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_items" ADD CONSTRAINT "promotion_items_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_items" ADD CONSTRAINT "promotion_items_dish_id_fkey" FOREIGN KEY ("dish_id") REFERENCES "dishes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_items" ADD CONSTRAINT "promotion_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "dish_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
