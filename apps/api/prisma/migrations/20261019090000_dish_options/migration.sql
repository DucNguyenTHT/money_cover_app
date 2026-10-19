-- Options / toppings for dishes (size, extras, requests) and their snapshot on order lines.

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "base_price" DECIMAL(16,2) NOT NULL DEFAULT 0,
ADD COLUMN     "options_key" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "recipe_factor" DECIMAL(8,4) NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "option_groups" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "multi" BOOLEAN NOT NULL DEFAULT false,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "max_select" INTEGER,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "option_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "options" (
    "id" SERIAL NOT NULL,
    "group_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "recipe_factor" DECIMAL(8,4) NOT NULL DEFAULT 1,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "option_ingredients" (
    "id" SERIAL NOT NULL,
    "option_id" INTEGER NOT NULL,
    "ingredient_id" INTEGER NOT NULL,
    "qty" DECIMAL(16,4) NOT NULL,

    CONSTRAINT "option_ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dish_option_groups" (
    "dish_id" INTEGER NOT NULL,
    "group_id" INTEGER NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "dish_option_groups_pkey" PRIMARY KEY ("dish_id","group_id")
);

-- CreateTable
CREATE TABLE "order_item_options" (
    "id" SERIAL NOT NULL,
    "order_item_id" INTEGER NOT NULL,
    "option_id" INTEGER,
    "group_name" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(16,2) NOT NULL,

    CONSTRAINT "order_item_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_item_extras" (
    "id" SERIAL NOT NULL,
    "order_item_id" INTEGER NOT NULL,
    "ingredient_id" INTEGER NOT NULL,
    "qty" DECIMAL(16,4) NOT NULL,

    CONSTRAINT "order_item_extras_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "options_group_id_idx" ON "options"("group_id");

-- CreateIndex
CREATE UNIQUE INDEX "option_ingredients_option_id_ingredient_id_key" ON "option_ingredients"("option_id", "ingredient_id");

-- CreateIndex
CREATE INDEX "order_item_options_order_item_id_idx" ON "order_item_options"("order_item_id");

-- CreateIndex
CREATE INDEX "order_item_options_option_id_idx" ON "order_item_options"("option_id");

-- CreateIndex
CREATE INDEX "order_item_extras_order_item_id_idx" ON "order_item_extras"("order_item_id");

-- CreateIndex
CREATE INDEX "order_item_extras_ingredient_id_idx" ON "order_item_extras"("ingredient_id");

-- AddForeignKey
ALTER TABLE "options" ADD CONSTRAINT "options_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "option_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "option_ingredients" ADD CONSTRAINT "option_ingredients_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "options"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "option_ingredients" ADD CONSTRAINT "option_ingredients_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dish_option_groups" ADD CONSTRAINT "dish_option_groups_dish_id_fkey" FOREIGN KEY ("dish_id") REFERENCES "dishes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dish_option_groups" ADD CONSTRAINT "dish_option_groups_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "option_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_options" ADD CONSTRAINT "order_item_options_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_options" ADD CONSTRAINT "order_item_options_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "options"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_extras" ADD CONSTRAINT "order_item_extras_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_extras" ADD CONSTRAINT "order_item_extras_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Lines sold before options existed: the base price is the price they were sold at.
UPDATE "order_items" SET "base_price" = "unit_price";
