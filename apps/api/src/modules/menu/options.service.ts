// Option groups (size, toppings, requests) shared by dishes, and which dishes use them.
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { prisma, inTx, type Db } from '../../core/db';
import { badRequest, notFound } from '../../core/errors';
import { writeAudit } from '../../core/audit';
import type { OptionGroupDto, optionGroupInput } from '../../contracts/menu.contract';
import type { OptionGroupDef } from '../../domain/menu/options';
import { D } from '../../domain/money';
import { recipeToStock, stockToRecipe } from '../../domain/recipes/recipes';

type Input = z.infer<typeof optionGroupInput>;

const groupInclude = Prisma.validator<Prisma.OptionGroupInclude>()({
  options: {
    orderBy: [{ sort: 'asc' }, { id: 'asc' }],
    include: { ingredients: { include: { ingredient: true }, orderBy: { id: 'asc' } } },
  },
  _count: { select: { dishes: true } },
});
type GroupRow = Prisma.OptionGroupGetPayload<{ include: typeof groupInclude }>;

function toDto(g: GroupRow): OptionGroupDto {
  return {
    id: g.id,
    name: g.name,
    multi: g.multi,
    required: g.required,
    maxSelect: g.maxSelect,
    sort: g.sort,
    active: g.active,
    dishCount: g._count.dishes,
    options: g.options.map((o) => ({
      id: o.id,
      name: o.name,
      price: o.price.toString(),
      recipeFactor: o.recipeFactor.toString(),
      isDefault: o.isDefault,
      active: o.active,
      sort: o.sort,
      ingredients: o.ingredients.map((i) => ({
        ingredientId: i.ingredientId,
        ingredientName: i.ingredient.name,
        recipeUnit: i.ingredient.recipeUnit,
        qty: stockToRecipe(i.qty.toString(), i.ingredient.recipeFactor.toString())
          .toDecimalPlaces(3)
          .toString(),
      })),
    })),
  };
}

export async function list(): Promise<OptionGroupDto[]> {
  const rows = await prisma.optionGroup.findMany({
    include: groupInclude,
    orderBy: [{ active: 'desc' }, { sort: 'asc' }, { id: 'asc' }],
  });
  return rows.map(toDto);
}

async function one(id: number, db: Db = prisma) {
  const g = await db.optionGroup.findUnique({ where: { id }, include: groupInclude });
  if (!g) throw notFound('Nhóm tuỳ chọn');
  return toDto(g);
}

function check(input: Input) {
  if (!input.multi && input.options.filter((o) => o.isDefault && o.active).length > 1)
    throw badRequest('Nhóm chọn 1 chỉ được có 1 tuỳ chọn chọn sẵn');
  if (!input.multi && input.maxSelect !== null) throw badRequest('Nhóm chọn 1 không có "tối đa"');
  for (const o of input.options) {
    const ids = o.ingredients.map((i) => i.ingredientId);
    if (new Set(ids).size !== ids.length) throw badRequest(`${o.name}: một nguyên liệu khai báo 2 lần`);
  }
}

/**
 * Create or update a group with its options. Options left out of the list are deleted, or only hidden when an
 * order already used them (orders keep a snapshot, the row stays for reports).
 */
export async function save(userId: number, id: number | null, input: Input) {
  check(input);
  const ingIds = [...new Set(input.options.flatMap((o) => o.ingredients.map((i) => i.ingredientId)))];
  const ings = await prisma.ingredient.findMany({ where: { id: { in: ingIds } } });
  if (ings.length !== ingIds.length) throw badRequest('Có nguyên liệu không tồn tại');
  const toStock = (ingredientId: number, qty: string) =>
    recipeToStock(qty, ings.find((x) => x.id === ingredientId)!.recipeFactor.toString())
      .toDecimalPlaces(4)
      .toString();

  const groupId = await inTx(async (tx) => {
    const before = id ? await one(id, tx) : null;
    const data = {
      name: input.name,
      multi: input.multi,
      required: input.required,
      maxSelect: input.multi ? input.maxSelect : null,
      sort: input.sort,
      active: input.active,
    };
    const g = id
      ? await tx.optionGroup.update({ where: { id }, data })
      : await tx.optionGroup.create({ data });

    const existing = await tx.option.findMany({
      where: { groupId: g.id },
      include: { _count: { select: { orderItems: true } } },
    });
    for (const o of input.options) {
      if (o.id !== null && !existing.some((e) => e.id === o.id))
        throw badRequest('Tuỳ chọn không thuộc nhóm này');
      const fields = {
        name: o.name,
        price: o.price,
        recipeFactor: o.recipeFactor,
        isDefault: o.isDefault,
        active: o.active,
        sort: o.sort,
      };
      const row =
        o.id === null
          ? await tx.option.create({ data: { ...fields, groupId: g.id } })
          : await tx.option.update({ where: { id: o.id }, data: fields });
      await tx.optionIngredient.deleteMany({ where: { optionId: row.id } });
      if (o.ingredients.length)
        await tx.optionIngredient.createMany({
          data: o.ingredients.map((i) => ({
            optionId: row.id,
            ingredientId: i.ingredientId,
            qty: toStock(i.ingredientId, i.qty),
          })),
        });
    }
    for (const e of existing.filter((x) => !input.options.some((o) => o.id === x.id))) {
      if (e._count.orderItems > 0) await tx.option.update({ where: { id: e.id }, data: { active: false } });
      else await tx.option.delete({ where: { id: e.id } });
    }
    await writeAudit(tx, {
      entity: 'option_group',
      entityId: g.id,
      action: id ? 'UPDATE' : 'CREATE',
      before,
      after: input,
      userId,
    });
    return g.id;
  });
  return one(groupId);
}

/** Groups of a dish in POS order (replaces the previous list). */
export async function setDishGroups(userId: number, dishId: number, groupIds: number[]) {
  const dish = await prisma.dish.findUnique({ where: { id: dishId }, include: { optionGroups: true } });
  if (!dish) throw notFound('Món');
  const ids = [...new Set(groupIds)];
  if ((await prisma.optionGroup.count({ where: { id: { in: ids } } })) !== ids.length)
    throw badRequest('Có nhóm tuỳ chọn không tồn tại');
  await inTx(async (tx) => {
    await tx.dishOptionGroup.deleteMany({ where: { dishId } });
    if (ids.length)
      await tx.dishOptionGroup.createMany({ data: ids.map((groupId, sort) => ({ dishId, groupId, sort })) });
    await writeAudit(tx, {
      entity: 'dish',
      entityId: dishId,
      action: 'SET_OPTION_GROUPS',
      before: dish.optionGroups.map((g) => g.groupId),
      after: ids,
      userId,
    });
  });
}

/** Option groups of some dishes, as the domain needs them (stock-unit ingredient quantities). */
export async function groupsForDishes(db: Db, dishIds: number[]): Promise<Map<number, OptionGroupDef[]>> {
  const links = await db.dishOptionGroup.findMany({
    where: { dishId: { in: dishIds } },
    orderBy: { sort: 'asc' },
    include: {
      group: {
        include: { options: { orderBy: [{ sort: 'asc' }, { id: 'asc' }], include: { ingredients: true } } },
      },
    },
  });
  const out = new Map<number, OptionGroupDef[]>();
  for (const l of links) {
    const g = l.group;
    out.set(l.dishId, [
      ...(out.get(l.dishId) ?? []),
      {
        id: g.id,
        name: g.name,
        multi: g.multi,
        required: g.required,
        maxSelect: g.maxSelect,
        active: g.active,
        options: g.options.map((o) => ({
          id: o.id,
          name: o.name,
          price: o.price.toString(),
          recipeFactor: o.recipeFactor.toString(),
          isDefault: o.isDefault,
          active: o.active,
          ingredients: o.ingredients.map((i) => ({ ingredientId: i.ingredientId, qty: D(i.qty.toString()) })),
        })),
      },
    ]);
  }
  return out;
}
