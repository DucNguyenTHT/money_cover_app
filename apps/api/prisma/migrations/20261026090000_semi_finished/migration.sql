-- Semi-finished goods (bán thành phẩm): recipes per batch, productions that turn ingredients into a lot.

-- AlterEnum
ALTER TYPE "IngredientKind" ADD VALUE 'SEMI';

-- AlterEnum
ALTER TYPE "IssueReason" ADD VALUE 'PRODUCTION';

-- AlterTable
ALTER TABLE "lots" ADD COLUMN     "production_id" INTEGER;

-- CreateTable
CREATE TABLE "semi_recipes" (
    "id" SERIAL NOT NULL,
    "ingredient_id" INTEGER NOT NULL,
    "effective_from" DATE NOT NULL,
    "yield_qty" DECIMAL(16,4) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "semi_recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "semi_recipe_items" (
    "id" SERIAL NOT NULL,
    "recipe_id" INTEGER NOT NULL,
    "ingredient_id" INTEGER NOT NULL,
    "qty" DECIMAL(16,4) NOT NULL,

    CONSTRAINT "semi_recipe_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "productions" (
    "id" SERIAL NOT NULL,
    "branch_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "ingredient_id" INTEGER NOT NULL,
    "qty" DECIMAL(16,4) NOT NULL,
    "cost_total" DECIMAL(16,2) NOT NULL,
    "unit_cost" DECIMAL(16,4) NOT NULL,
    "issue_id" INTEGER NOT NULL,
    "note" TEXT,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "productions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "semi_recipes_ingredient_id_effective_from_key" ON "semi_recipes"("ingredient_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "semi_recipe_items_recipe_id_ingredient_id_key" ON "semi_recipe_items"("recipe_id", "ingredient_id");

-- CreateIndex
CREATE UNIQUE INDEX "productions_issue_id_key" ON "productions"("issue_id");

-- CreateIndex
CREATE INDEX "productions_branch_id_date_idx" ON "productions"("branch_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "lots_production_id_key" ON "lots"("production_id");

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_production_id_fkey" FOREIGN KEY ("production_id") REFERENCES "productions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "semi_recipes" ADD CONSTRAINT "semi_recipes_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "semi_recipe_items" ADD CONSTRAINT "semi_recipe_items_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "semi_recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "semi_recipe_items" ADD CONSTRAINT "semi_recipe_items_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productions" ADD CONSTRAINT "productions_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

