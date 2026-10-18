-- Selling price per delivery app: an APP price may name one app; null = every app without its own price.

-- DropIndex
DROP INDEX "dish_prices_dish_id_price_type_effective_from_key";

-- AlterTable
ALTER TABLE "dish_prices" ADD COLUMN     "delivery_app_id" INTEGER;

-- CreateIndex (NULLS NOT DISTINCT: still only one general price per dish, type and day)
CREATE UNIQUE INDEX "dish_prices_dish_id_price_type_delivery_app_id_effective_fr_key" ON "dish_prices"("dish_id", "price_type", "delivery_app_id", "effective_from") NULLS NOT DISTINCT;

-- AddForeignKey
ALTER TABLE "dish_prices" ADD CONSTRAINT "dish_prices_delivery_app_id_fkey" FOREIGN KEY ("delivery_app_id") REFERENCES "delivery_apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
