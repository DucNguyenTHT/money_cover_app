import { prisma } from '../../src/core/db';

let seq = 0;

/** Create an ingredient quickly (kg stock unit, g recipe unit unless overridden). */
export async function makeIngredient(
  over: Partial<{
    name: string;
    unit: string;
    purchaseUnit: string;
    purchaseFactor: string;
    kind: 'INGREDIENT' | 'PACKAGING';
  }> = {},
) {
  seq += 1;
  return prisma.ingredient.create({
    data: {
      code: `NL${seq}`,
      name: over.name ?? `Nguyên liệu ${seq}`,
      kind: over.kind ?? 'INGREDIENT',
      unit: over.unit ?? 'kg',
      recipeUnit: over.unit ? over.unit : 'g',
      recipeFactor: over.unit ? 1 : 1000,
      purchaseUnit: over.purchaseUnit ?? null,
      purchaseFactor: over.purchaseFactor ?? 1,
    },
  });
}

export const branchId = async () => (await prisma.branch.findFirstOrThrow()).id;
