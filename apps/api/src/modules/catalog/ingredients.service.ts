import type { Ingredient, Prisma } from '@prisma/client';
import type { z } from 'zod';
import { prisma } from '../../core/db';
import { notFound } from '../../core/errors';
import { writeAudit } from '../../core/audit';
import type { IngredientDto, ingredientInput } from '../../contracts/catalog.contract';

type Input = z.infer<typeof ingredientInput>;

export const toIngredientDto = (i: Ingredient): IngredientDto => ({
  id: i.id,
  code: i.code,
  name: i.name,
  kind: i.kind,
  unit: i.unit,
  recipeUnit: i.recipeUnit,
  recipeFactor: i.recipeFactor.toString(),
  purchaseUnit: i.purchaseUnit,
  purchaseFactor: i.purchaseFactor.toString(),
  category: i.category,
  active: i.active,
});

export async function list(q?: string, active?: boolean) {
  const where: Prisma.IngredientWhereInput = {
    ...(active === undefined ? {} : { active }),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { code: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const rows = await prisma.ingredient.findMany({
    where,
    orderBy: [{ active: 'desc' }, { category: 'asc' }, { name: 'asc' }],
  });
  return rows.map(toIngredientDto);
}

const data = (i: Input) => ({
  ...i,
  purchaseUnit: i.purchaseUnit || null,
  category: i.category || null,
});

export async function create(userId: number, input: Input) {
  const row = await prisma.ingredient.create({ data: data(input) });
  await writeAudit(prisma, {
    entity: 'ingredient',
    entityId: row.id,
    action: 'CREATE',
    after: input,
    userId,
  });
  return toIngredientDto(row);
}

export async function update(userId: number, id: number, input: Input) {
  const before = await prisma.ingredient.findUnique({ where: { id } });
  if (!before) throw notFound('Nguyên liệu');
  const row = await prisma.ingredient.update({ where: { id }, data: data(input) });
  await writeAudit(prisma, {
    entity: 'ingredient',
    entityId: id,
    action: 'UPDATE',
    before: toIngredientDto(before),
    after: input,
    userId,
  });
  return toIngredientDto(row);
}
