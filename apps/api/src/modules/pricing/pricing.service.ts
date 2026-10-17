import { Prisma } from '@prisma/client';
import { prisma } from '../../core/db';
import { notFound } from '../../core/errors';
import { defaultBranchId } from '../../core/branch';
import { fromDbDate, toDbDate } from '../../domain/business-date';
import { D, ZERO } from '../../domain/money';
import { pickVersion, stockToRecipe } from '../../domain/recipes/recipes';
import {
  costSheet,
  overheadRate,
  priceAlert,
  suggestAppPrice,
  suggestStorePrice,
  type ChannelCost,
} from '../../domain/pricing/pricing';
import type {
  ChannelCostDto,
  PricingContext,
  PricingDetail,
  PricingRow,
} from '../../contracts/pricing.contract';
import { businessToday, getSettings } from '../settings/settings.service';

const str = (d: Prisma.Decimal | ReturnType<typeof D> | null) => (d === null ? null : d.toString());
const dto = (c: ChannelCost): ChannelCostDto => ({
  channel: c.channel,
  price: str(c.price),
  ingredientCost: c.ingredientCost.toString(),
  packagingCost: c.packagingCost.toString(),
  directCost: c.directCost.toString(),
  commission: c.commission.toString(),
  overhead: c.overhead.toString(),
  totalCost: c.totalCost.toString(),
  profit: str(c.profit),
  profitPct: str(c.profitPct),
  foodCostPct: str(c.foodCostPct),
});

/** Overhead % used for pricing: manual value, or overhead ÷ net revenue of the last 3 full months. */
export async function overheadPct(): Promise<{ pct: string; mode: 'AUTO' | 'MANUAL' }> {
  const s = await getSettings();
  if (s.overhead_rate_mode === 'MANUAL') return { pct: String(s.overhead_rate_manual), mode: 'MANUAL' };
  const today = await businessToday();
  const [y, m] = today.split('-').map(Number) as [number, number];
  const months = [1, 2, 3].map((k) => {
    const d = new Date(Date.UTC(y, m - 1 - k, 1));
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
  });
  const branchId = await defaultBranchId();
  const oh = await prisma.overheadExpense.aggregate({
    where: { branchId, OR: months.map((x) => ({ year: x.year, month: x.month })) },
    _sum: { amount: true },
  });
  const from = toDbDate(`${months[2]!.year}-${String(months[2]!.month).padStart(2, '0')}-01`);
  const to = toDbDate(`${y}-${String(m).padStart(2, '0')}-01`);
  const rev = await prisma.order.aggregate({
    where: { branchId, status: 'PAID', businessDate: { gte: from, lt: to } },
    _sum: { netRevenue: true },
  });
  const rate = overheadRate(oh._sum.amount?.toString() ?? 0, rev._sum.netRevenue?.toString() ?? 0);
  return { pct: rate ? rate.toString() : String(s.overhead_rate_manual), mode: 'AUTO' };
}

async function context(appId?: number): Promise<PricingContext> {
  const { pct, mode } = await overheadPct();
  const apps = await prisma.deliveryApp.findMany({
    where: { active: true },
    orderBy: { commissionPct: 'desc' },
  });
  const app = (appId ? apps.find((a) => a.id === appId) : undefined) ?? apps[0];
  return {
    overheadPct: pct,
    overheadMode: mode,
    app: app ? { id: app.id, name: app.name, commissionPct: app.commissionPct.toString() } : null,
  };
}

/** Latest lot price per ingredient (per stock unit). */
async function latestPrices() {
  const lots = await prisma.lot.findMany({
    where: { branchId: await defaultBranchId() },
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
    distinct: ['ingredientId'],
    select: { ingredientId: true, unitPrice: true },
  });
  return new Map(lots.map((l) => [l.ingredientId, l.unitPrice.toString()]));
}

async function buildRows(ctx: PricingContext, onlyDishId?: number): Promise<PricingDetail[]> {
  const s = await getSettings();
  const today = await businessToday();
  const prices = await latestPrices();
  const dishes = await prisma.dish.findMany({
    where: { active: true, ...(onlyDishId ? { id: onlyDishId } : {}) },
    include: {
      category: true,
      prices: { orderBy: { effectiveFrom: 'desc' } },
      recipes: { include: { items: { include: { ingredient: true } } } },
    },
    orderBy: [{ category: { sort: 'asc' } }, { sort: 'asc' }, { name: 'asc' }],
  });
  const commission = ctx.app?.commissionPct ?? '0';

  return dishes.map((d) => {
    const versions = d.recipes.map((r) => ({ effectiveFrom: fromDbDate(r.effectiveFrom), r }));
    const recipe = pickVersion(versions, today)?.r;
    const priceOf = (t: 'STORE' | 'APP') =>
      d.prices.find((p) => p.priceType === t && fromDbDate(p.effectiveFrom) <= today)?.price.toString() ??
      null;
    const storePrice = priceOf('STORE');
    const appPrice = priceOf('APP') ?? storePrice;
    const items = recipe?.items ?? [];
    const lines = items.map((i) => ({
      ingredientId: i.ingredientId,
      kind: i.ingredient.kind,
      scope: i.scope,
      qty: i.qty.toString(),
      unitPrice: prices.get(i.ingredientId) ?? null,
    }));
    const sheet = costSheet({
      lines,
      storePrice,
      appPrice,
      appCommissionPct: commission,
      overheadPct: ctx.overheadPct,
    });
    const target = d.category.foodCostTarget?.toString() ?? String(s.food_cost_target_default);
    const sugStore = suggestStorePrice(sheet.DINE_IN.directCost, target, s.price_rounding);
    const baseStore = storePrice ?? sugStore;
    const sugApp = baseStore
      ? suggestAppPrice({
          storePrice: baseStore,
          storeDirect: sheet.DINE_IN.directCost,
          appDirect: sheet.APP.directCost,
          overheadPct: ctx.overheadPct,
          commissionPct: commission,
          step: s.price_rounding,
        })
      : null;
    const alerts = [
      priceAlert(sheet.DINE_IN, target, s.alert_tolerance_pct),
      priceAlert(sheet.TAKEAWAY, target, s.alert_tolerance_pct),
      priceAlert(sheet.APP, 100, 0),
    ];
    const alert = alerts.includes('LOSS') ? 'LOSS' : alerts[0] === 'OVER_TARGET' ? 'OVER_TARGET' : null;

    return {
      dishId: d.id,
      code: d.code,
      name: d.name,
      categoryName: d.category.name,
      targetPct: target,
      hasRecipe: !!recipe,
      missingPrices: items.filter((i) => !prices.has(i.ingredientId)).map((i) => i.ingredient.name),
      channels: { DINE_IN: dto(sheet.DINE_IN), TAKEAWAY: dto(sheet.TAKEAWAY), APP: dto(sheet.APP) },
      suggestedStorePrice: str(sugStore),
      suggestedAppPrice: str(sugApp),
      alert: recipe ? alert : null,
      lines: items.map((i) => {
        const p = prices.get(i.ingredientId) ?? null;
        const factor = i.ingredient.recipeFactor.toString();
        return {
          ingredientId: i.ingredientId,
          name: i.ingredient.name,
          kind: i.ingredient.kind,
          scope: i.scope,
          qtyRecipe: stockToRecipe(i.qty.toString(), factor).toDecimalPlaces(3).toString(),
          recipeUnit: i.ingredient.recipeUnit,
          unitPriceRecipe: p ? D(p).div(factor).toDecimalPlaces(2).toString() : null,
          cost: p ? D(i.qty.toString()).mul(p).toDecimalPlaces(0).toString() : ZERO.toString(),
        };
      }),
    };
  });
}

const stripLines = ({ lines: _l, ...row }: PricingDetail): PricingRow => row;

export async function list(appId?: number) {
  const ctx = await context(appId);
  return { context: ctx, rows: (await buildRows(ctx)).map(stripLines) };
}

export async function detail(dishId: number, appId?: number) {
  const ctx = await context(appId);
  const [row] = await buildRows(ctx, dishId);
  if (!row) throw notFound('Món');
  return { context: ctx, row };
}

export async function alerts() {
  const ctx = await context();
  return (await buildRows(ctx)).map(stripLines).filter((r) => r.alert !== null);
}
