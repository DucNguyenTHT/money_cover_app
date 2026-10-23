-- Minimum stock per ingredient (stock unit): below it the ingredient is "running low" and a reorder is suggested.
ALTER TABLE "ingredients" ADD COLUMN     "min_stock" DECIMAL(16,4);
