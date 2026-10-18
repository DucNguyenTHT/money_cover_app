import type { Prisma, PriceType } from '@prisma/client';
import type { z } from 'zod';
import { prisma, inTx, type Db } from '../../core/db';
import { badRequest, conflict, notFound } from '../../core/errors';
import { writeAudit } from '../../core/audit';
import { assertPeriodOpen } from '../../core/period-lock';
import { emit } from '../../core/realtime';
import { socketRooms } from '../../contracts/socket-events';
import { fromDbDate, toDbDate } from '../../domain/business-date';
import { pickVersion, recipeToStock, stockToRecipe } from '../../domain/recipes/recipes';
import { ownAppPrices, priceInForce, sellingPrice, type PriceEntry } from '../../domain/pricing/price-list';
import type {
  categoryInput,
  DishDetail,
  DishDto,
  dishInput,
  recipeInput,
} from '../../contracts/menu.contract';
import { businessToday } from '../settings/settings.service';

const dishInclude = {
  category: true,
  prices: { orderBy: { effectiveFrom: 'desc' } },
  recipes: {
    orderBy: { effectiveFrom: 'desc' },
    include: { items: { include: { ingredient: true } }, _count: { select: { orderItems: true } } },
  },
} as const;
type DishRow = Prisma.DishGetPayload<{ include: typeof dishInclude }>;

export const priceEntries = (
  prices: {
    priceType: PriceType;
    deliveryAppId: number | null;
    effectiveFrom: Date;
    price: Prisma.Decimal;
  }[],
): PriceEntry[] =>
  prices.map((p) => ({
    priceType: p.priceType,
    deliveryAppId: p.deliveryAppId,
    effectiveFrom: fromDbDate(p.effectiveFrom),
    price: p.price.toString(),
  }));

function toDish(d: DishRow, date: string, today: string): DishDto {
  const prices = priceEntries(d.prices);
  const versions = d.recipes.map((r) => ({ effectiveFrom: fromDbDate(r.effectiveFrom), r }));
  return {
    id: d.id,
    code: d.code,
    name: d.name,
    categoryId: d.categoryId,
    categoryName: d.category.name,
    station: d.category.station,
    active: d.active,
    sort: d.sort,
    storePrice: priceInForce(prices, 'STORE', null, date),
    appPrice: sellingPrice(prices, 'APP', null, date),
    appPrices: ownAppPrices(prices, date),
    soldOut: !!d.soldOutDate && fromDbDate(d.soldOutDate) === today,
    hasRecipe: !!pickVersion(versions, date),
  };
}

function toDetail(d: DishRow, date: string, today: string): DishDetail {
  return {
    ...toDish(d, date, today),
    prices: d.prices.map((p) => ({
      id: p.id,
      priceType: p.priceType,
      deliveryAppId: p.deliveryAppId,
      price: p.price.toString(),
      effectiveFrom: fromDbDate(p.effectiveFrom),
    })),
    recipes: d.recipes.map((r) => ({
      id: r.id,
      effectiveFrom: fromDbDate(r.effectiveFrom),
      note: r.note,
      used: r._count.orderItems > 0,
      items: r.items.map((i) => ({
        ingredientId: i.ingredientId,
        ingredientName: i.ingredient.name,
        recipeUnit: i.ingredient.recipeUnit,
        kind: i.ingredient.kind,
        qty: stockToRecipe(i.qty.toString(), i.ingredient.recipeFactor.toString())
          .toDecimalPlaces(3)
          .toString(),
        scope: i.scope,
      })),
    })),
  };
}

// ---------------------------------------------------------------- categories

export async function listCategories() {
  const rows = await prisma.dishCategory.findMany({
    orderBy: [{ sort: 'asc' }, { id: 'asc' }],
    include: { _count: { select: { dishes: true } } },
  });
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    foodCostTarget: c.foodCostTarget?.toString() ?? null,
    station: c.station,
    taxGroup: c.taxGroup,
    sort: c.sort,
    dishCount: c._count.dishes,
  }));
}

export async function saveCategory(userId: number, id: number | null, input: z.infer<typeof categoryInput>) {
  const data = { ...input, foodCostTarget: input.foodCostTarget || null };
  const row = id
    ? await prisma.dishCategory.update({ where: { id }, data })
    : await prisma.dishCategory.create({ data });
  await writeAudit(prisma, {
    entity: 'dish_category',
    entityId: row.id,
    action: id ? 'UPDATE' : 'CREATE',
    after: input,
    userId,
  });
  return (await listCategories()).find((c) => c.id === row.id)!;
}

// ---------------------------------------------------------------- dishes

export async function listDishes(date?: string) {
  const today = await businessToday();
  const rows = await prisma.dish.findMany({
    include: dishInclude,
    orderBy: [{ category: { sort: 'asc' } }, { sort: 'asc' }, { name: 'asc' }],
  });
  return rows.map((d) => toDish(d, date ?? today, today));
}

export async function getDish(id: number, db: Db = prisma) {
  const d = await db.dish.findUnique({ where: { id }, include: dishInclude });
  if (!d) throw notFound('Món');
  const today = await businessToday(db);
  return toDetail(d, today, today);
}

export async function createDish(
  userId: number,
  input: z.infer<typeof dishInput> & { storePrice: string | null; appPrice: string | null },
) {
  const today = await businessToday();
  const id = await inTx(async (tx) => {
    const { storePrice, appPrice, ...dish } = input;
    const d = await tx.dish.create({ data: dish });
    const prices = [
      ...(storePrice ? [{ priceType: 'STORE' as const, price: storePrice }] : []),
      ...(appPrice ? [{ priceType: 'APP' as const, price: appPrice }] : []),
    ];
    for (const p of prices) {
      await tx.dishPrice.create({
        data: { dishId: d.id, ...p, effectiveFrom: toDbDate(today), createdById: userId },
      });
    }
    await writeAudit(tx, { entity: 'dish', entityId: d.id, action: 'CREATE', after: input, userId });
    return d.id;
  });
  return getDish(id);
}

export async function updateDish(userId: number, id: number, input: z.infer<typeof dishInput>) {
  const before = await getDish(id);
  await prisma.dish.update({ where: { id }, data: input });
  await writeAudit(prisma, { entity: 'dish', entityId: id, action: 'UPDATE', before, after: input, userId });
  return getDish(id);
}

const viDate = (d: string) => d.split('-').reverse().join('/');

/**
 * A price or recipe dated in the past would claim that orders already sold since then used it, while they
 * keep the price / recipe they were sold with. Allowed only while the dish has no sale on or after that date.
 */
async function assertNotBeforeSales(db: Db, dishId: number, from: string, what: string) {
  const today = await businessToday(db);
  if (from >= today) return;
  const sold = await db.orderItem.findFirst({
    where: { dishId, order: { businessDate: { gte: toDbDate(from) } } },
    select: { order: { select: { businessDate: true } } },
    orderBy: { order: { businessDate: 'asc' } },
  });
  if (sold)
    throw conflict(
      'BACKDATED',
      `Món đã có đơn bán ngày ${viDate(fromDbDate(sold.order.businessDate))}, sau ngày ${viDate(from)} — ${what} chỉ áp dụng được từ hôm nay (${viDate(today)}) trở đi`,
    );
}

export async function setPrice(
  userId: number,
  dishId: number,
  input: { priceType: PriceType; deliveryAppId: number | null; price: string; effectiveFrom: string },
) {
  await getDish(dishId);
  const deliveryAppId = input.priceType === 'APP' ? input.deliveryAppId : null;
  if (deliveryAppId !== null && !(await prisma.deliveryApp.findUnique({ where: { id: deliveryAppId } })))
    throw badRequest('App giao hàng không tồn tại');
  await inTx(async (tx) => {
    await assertPeriodOpen(tx, input.effectiveFrom);
    await assertNotBeforeSales(tx, dishId, input.effectiveFrom, 'giá mới');
    // Not an upsert: Prisma cannot address a compound unique key with a null app.
    const key = {
      dishId,
      priceType: input.priceType,
      deliveryAppId,
      effectiveFrom: toDbDate(input.effectiveFrom),
    };
    const before = await tx.dishPrice.findFirst({ where: key });
    if (before)
      await tx.dishPrice.update({
        where: { id: before.id },
        data: { price: input.price, createdById: userId },
      });
    else await tx.dishPrice.create({ data: { ...key, price: input.price, createdById: userId } });
    await writeAudit(tx, {
      entity: 'dish_price',
      entityId: dishId,
      action: 'SET_PRICE',
      before: before?.price.toString() ?? null,
      after: input,
      userId,
    });
  });
  return getDish(dishId);
}

export async function saveRecipe(userId: number, dishId: number, input: z.infer<typeof recipeInput>) {
  await getDish(dishId);
  const ids = [...new Set(input.items.map((i) => i.ingredientId))];
  const ings = await prisma.ingredient.findMany({ where: { id: { in: ids } } });
  if (ings.length !== ids.length) throw badRequest('Có nguyên liệu không tồn tại');
  const keys = input.items.map((i) => `${i.ingredientId}:${i.scope}`);
  if (new Set(keys).size !== keys.length)
    throw badRequest('Một nguyên liệu bị khai báo 2 lần trong cùng phạm vi');

  await inTx(async (tx) => {
    await assertPeriodOpen(tx, input.effectiveFrom);
    await assertNotBeforeSales(tx, dishId, input.effectiveFrom, 'định mức mới');
    const existing = await tx.dishRecipe.findUnique({
      where: { dishId_effectiveFrom: { dishId, effectiveFrom: toDbDate(input.effectiveFrom) } },
      include: { _count: { select: { orderItems: true } }, items: true },
    });
    if (existing && existing._count.orderItems > 0) {
      throw conflict(
        'RECIPE_USED',
        'Định mức áp dụng từ ngày này đã được dùng cho đơn hàng — hãy tạo phiên bản mới từ ngày khác',
      );
    }
    const items = input.items.map((i) => {
      const ing = ings.find((x) => x.id === i.ingredientId)!;
      return {
        ingredientId: i.ingredientId,
        scope: i.scope,
        qty: recipeToStock(i.qty, ing.recipeFactor.toString()).toDecimalPlaces(4).toString(),
      };
    });
    if (existing) {
      await tx.dishRecipeItem.deleteMany({ where: { recipeId: existing.id } });
      await tx.dishRecipe.update({
        where: { id: existing.id },
        data: { note: input.note, items: { create: items } },
      });
    } else {
      await tx.dishRecipe.create({
        data: {
          dishId,
          effectiveFrom: toDbDate(input.effectiveFrom),
          note: input.note,
          items: { create: items },
        },
      });
    }
    await writeAudit(tx, {
      entity: 'recipe',
      entityId: dishId,
      action: existing ? 'UPDATE' : 'CREATE',
      before: existing?.items,
      after: input,
      userId,
    });
  });
  return getDish(dishId);
}

export async function deleteRecipe(userId: number, dishId: number, recipeId: number, reason: string) {
  const r = await prisma.dishRecipe.findFirst({
    where: { id: recipeId, dishId },
    include: { _count: { select: { orderItems: true } }, items: true },
  });
  if (!r) throw notFound('Định mức');
  if (r._count.orderItems > 0)
    throw conflict('RECIPE_USED', 'Định mức đã được dùng cho đơn hàng, không thể xoá');
  await inTx(async (tx) => {
    await assertPeriodOpen(tx, fromDbDate(r.effectiveFrom));
    await tx.dishRecipe.delete({ where: { id: recipeId } });
    await writeAudit(tx, { entity: 'recipe', entityId: dishId, action: 'DELETE', reason, before: r, userId });
  });
  return getDish(dishId);
}

export async function setAvailability(userId: number, dishId: number, soldOut: boolean) {
  const today = await businessToday();
  const d = await prisma.dish.findUnique({ where: { id: dishId } });
  if (!d) throw notFound('Món');
  await prisma.dish.update({
    where: { id: dishId },
    data: { soldOutDate: soldOut ? toDbDate(today) : null },
  });
  await writeAudit(prisma, {
    entity: 'dish',
    entityId: dishId,
    action: soldOut ? 'SOLD_OUT' : 'AVAILABLE',
    userId,
  });
  emit(socketRooms.pos, 'dish:availability', { dishId, soldOut });
  const row = await prisma.dish.findUniqueOrThrow({ where: { id: dishId }, include: dishInclude });
  return toDish(row, today, today);
}
