import type { Ingredient, Prisma } from '@prisma/client';
import type { z } from 'zod';
import { prisma } from '../../core/db';
import { conflict, notFound } from '../../core/errors';
import { writeAudit } from '../../core/audit';
import type { IngredientDto, ingredientInput } from '../../contracts/catalog.contract';

type Input = z.infer<typeof ingredientInput>;

const usage = { _count: { select: { lots: true, recipeItems: true } } } as const;
type WithUsage = Ingredient & { _count: { lots: number; recipeItems: number } };

export const toIngredientDto = (i: WithUsage): IngredientDto => ({
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
  unitsLocked: i._count.lots > 0 || i._count.recipeItems > 0,
});

/** Units that give meaning to stored quantities (stock in `unit`, recipes converted with `recipeFactor`). */
export function unitChange(
  before: Ingredient,
  input: { unit: string; recipeUnit: string; recipeFactor: string },
) {
  return (
    before.unit !== input.unit ||
    before.recipeUnit !== input.recipeUnit ||
    !before.recipeFactor.equals(input.recipeFactor)
  );
}

export const UNITS_LOCKED_MESSAGE =
  'Nguyên liệu đã có tồn kho hoặc nằm trong định mức nên không đổi được đơn vị kho, đơn vị định mức và hệ số quy đổi (số tồn và định mức đang tính theo đơn vị cũ). Hãy tạo nguyên liệu mới nếu cần đơn vị khác.';

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
    include: usage,
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
  const row = await prisma.ingredient.create({ data: data(input), include: usage });
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
  const before = await prisma.ingredient.findUnique({ where: { id }, include: usage });
  if (!before) throw notFound('Nguyên liệu');
  if (unitChange(before, input) && toIngredientDto(before).unitsLocked)
    throw conflict('UNITS_LOCKED', UNITS_LOCKED_MESSAGE);
  const row = await prisma.ingredient.update({ where: { id }, data: data(input), include: usage });
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
