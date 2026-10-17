-- CreateEnum
CREATE TYPE "TaxGroup" AS ENUM ('DISTRIBUTION', 'SERVICE', 'PRODUCTION', 'OTHER');

-- AlterTable
ALTER TABLE "dish_categories" ADD COLUMN     "tax_group" "TaxGroup" NOT NULL DEFAULT 'PRODUCTION';
