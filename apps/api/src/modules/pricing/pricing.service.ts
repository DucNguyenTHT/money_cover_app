import { Prisma } from '@prisma/client';
import { prisma } from '../../core/db';
import { notFound } from '../../core/errors';
import { defaultBranchId } from '../../core/branch';
import { fromDbDate, toDbDate } from '../../domain/business-date';
import { D, ZERO } from '../../domain/money';
import { pickVersion, stockToRecipe } from '../../domain/recipes/recipes';
import { priceInForce, sellingPrice } from '../../domain/pricing/price-list';
import { priceEntries } from '../menu/menu.service';
import {
  chooseOverheadRate,
  costSheet,
  optionPricing,
  priceAlert,
  suggestAppPrice,
  suggestStorePrice,
  type ChannelCost,
  type OverheadChoice,
} from '../../domain/pricing/pricing';
import { groupsForDishes } from '../menu/options.service';
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

/** Overhead % used for pricing (see chooseOverheadRate): last 3 months the shop sold for in full, or manual. */
export async function overheadPct(): Promise<OverheadChoice> {
  const s = await getSettings();
  const base = { mode: s.overhead_rate_mode, manualPct: s.overhead_rate_manual };
  if (s.overhead_rate_mode === 'MANUAL') return chooseOverheadRate({ ...base, firstSale: null, months: [] });
  const today = await businessToday();
  const [y, m] = today.split('-').map(Number) as [number, number];
  // The 3 calendar months before the current one, oldest first.
  const months = [3, 2, 1].map((k) => {
    const d = new Date(Date.UTC(y, m - 1 - k, 1));
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
  });
  const key = (x: { year: number; month: number }) => `${x.year}-${String(x.month).padStart(2, '0')}`;
  const branchId = await defaultBranchId();
  const [oh, first, rev] = await Promise.all([
    prisma.overheadExpense.groupBy({
      by: ['year', 'month'],
      where: { branchId, OR: months.map((x) => ({ year: x.year, month: x.month })) },
      _sum: { amount: true },
    }),
    prisma.order.findFirst({
      where: { branchId, status: 'PAID' },
      orderBy: { businessDate: 'asc' },
      select: { businessDate: true },
    }),
    Promise.all(
      months.map((x) => {
        const next = new Date(Date.UTC(x.year, x.month, 1)).toISOString().slice(0, 10);
        return prisma.order.aggregate({
          where: {
            branchId,
            status: 'PAID',
            businessDate: { gte: toDbDate(`${key(x)}-01`), lt: toDbDate(next) },
          },
          _sum: { netRevenue: true },
        });
      }),
    ),
  ]);
  return chooseOverheadRate({
    ...base,
    firstSale: first ? fromDbDate(first.businessDate) : null,
    months: months.map((x, i) => ({
      month: key(x),
      overhead: oh.find((o) => o.year === x.year && o.month === x.month)?._sum.amount?.toString() ?? 0,
      revenue: rev[i]!._sum.netRevenue?.toString() ?? 0,
    })),
  });
}

type AppInfo = { id: number; name: string; commissionPct: string };

async function context(appId?: number): Promise<PricingContext & { apps: AppInfo[] }> {
  const oh = await overheadPct();
  const apps = (
    await prisma.deliveryApp.findMany({ where: { active: true }, orderBy: { commissionPct: 'desc' } })
  ).map((a) => ({ id: a.id, name: a.name, commissionPct: a.commissionPct.toString() }));
  const app = (appId ? apps.find((a) => a.id === appId) : undefined) ?? apps[0];
  return {
    overheadPct: oh.pct,
    overheadMode: oh.source,
    overheadNote: oh.note,
    overheadWarn: oh.warn,
    app: app ?? null,
    apps,
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

async function buildRows(
  ctx: PricingContext & { apps: AppInfo[] },
  onlyDishId?: number,
): Promise<PricingDetail[]> {
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
  const groups = await groupsForDishes(
    prisma,
    dishes.map((d) => d.id),
  );
  const extraIds = [...groups.values()]
    .flat()
    .flatMap((g) => g.options.flatMap((o) => o.ingredients.map((i) => i.ingredientId)));
  const extraNames = new Map(
    (
      await prisma.ingredient.findMany({ where: { id: { in: extraIds } }, select: { id: true, name: true } })
    ).map((i) => [i.id, i.name]),
  );
  return dishes.map((d) => {
    const versions = d.recipes.map((r) => ({ effectiveFrom: fromDbDate(r.effectiveFrom), r }));
    const recipe = pickVersion(versions, today)?.r;
    const entries = priceEntries(d.prices);
    const storePrice = priceInForce(entries, 'STORE', null, today);
    const items = recipe?.items ?? [];
    const lines = items.map((i) => ({
      ingredientId: i.ingredientId,
      kind: i.ingredient.kind,
      scope: i.scope,
      qty: i.qty.toString(),
      unitPrice: prices.get(i.ingredientId) ?? null,
    }));
    const target = d.category.foodCostTarget?.toString() ?? String(s.food_cost_target_default);

    // One cost sheet per app (its price and commission); the store columns are the same in all of them.
    const sheetFor = (app: AppInfo | null) =>
      costSheet({
        lines,
        storePrice,
        appPrice: sellingPrice(entries, 'APP', app?.id ?? null, today),
        appCommissionPct: app?.commissionPct ?? '0',
        overheadPct: ctx.overheadPct,
      });
    const sheet = sheetFor(ctx.app);
    const sugStore = suggestStorePrice(sheet.DINE_IN.directCost, target, s.price_rounding);
    const baseStore = storePrice ?? sugStore;
    const suggestFor = (commissionPct: string) =>
      baseStore
        ? suggestAppPrice({
            storePrice: baseStore,
            storeDirect: sheet.DINE_IN.directCost,
            appDirect: sheet.APP.directCost,
            overheadPct: ctx.overheadPct,
            commissionPct,
            step: s.price_rounding,
          })
        : null;
    const apps = ctx.apps.map((a) => {
      const c = sheetFor(a).APP;
      return {
        deliveryAppId: a.id,
        name: a.name,
        commissionPct: a.commissionPct,
        price: str(c.price),
        ownPrice: priceInForce(entries, 'APP', a.id, today) !== null,
        directCost: c.directCost.toString(),
        profit: str(c.profit),
        profitPct: str(c.profitPct),
        suggestedPrice: str(suggestFor(a.commissionPct)),
        loss: priceAlert(c, 100, 0) === 'LOSS',
      };
    });
    const alerts = [
      priceAlert(sheet.DINE_IN, target, s.alert_tolerance_pct),
      priceAlert(sheet.TAKEAWAY, target, s.alert_tolerance_pct),
      apps.some((a) => a.loss) ? ('LOSS' as const) : priceAlert(sheet.APP, 100, 0),
    ];
    const alert = alerts.includes('LOSS') ? 'LOSS' : alerts[0] === 'OVER_TARGET' ? 'OVER_TARGET' : null;

    const options = (groups.get(d.id) ?? [])
      .filter((g) => g.active)
      .flatMap((g) =>
        g.options
          .filter((o) => o.active)
          .map((o) => {
            const r = optionPricing({
              optionPrice: o.price,
              recipeFactor: o.recipeFactor,
              extras: o.ingredients.map((i) => ({
                qty: i.qty,
                unitPrice: prices.get(i.ingredientId) ?? null,
              })),
              dishCost: sheet.DINE_IN.directCost,
              dishPrice: storePrice,
              overheadPct: ctx.overheadPct,
              targetPct: target,
              tolerancePct: s.alert_tolerance_pct,
              step: s.price_rounding,
            });
            return {
              optionId: o.id,
              groupName: g.name,
              name: o.name,
              kind: r.kind,
              optionPrice: D(o.price).toString(),
              recipeFactor: D(o.recipeFactor).toString(),
              extraCost: r.extraCost.toString(),
              price: str(r.price),
              cost: r.cost.toString(),
              profit: str(r.profit),
              foodCostPct: str(r.foodCostPct),
              suggestedPrice: str(r.suggested),
              // A size without the dish recipe has no cost to judge.
              alert: r.kind === 'SIZE' && !recipe ? null : r.alert,
              missingPrices: o.ingredients
                .filter((i) => !prices.has(i.ingredientId))
                .map((i) => extraNames.get(i.ingredientId) ?? ''),
            };
          }),
      );
    const optionAlert = options.some((o) => o.alert === 'LOSS')
      ? 'LOSS'
      : options.some((o) => o.alert === 'OVER_TARGET')
        ? 'OVER_TARGET'
        : null;

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
      suggestedAppPrice: str(suggestFor(ctx.app?.commissionPct ?? '0')),
      apps,
      alert: recipe ? alert : null,
      options,
      optionAlert,
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
const publicCtx = ({ apps: _a, ...c }: PricingContext & { apps: AppInfo[] }): PricingContext => c;

export async function list(appId?: number) {
  const ctx = await context(appId);
  return { context: publicCtx(ctx), rows: (await buildRows(ctx)).map(stripLines) };
}

export async function detail(dishId: number, appId?: number) {
  const ctx = await context(appId);
  const [row] = await buildRows(ctx, dishId);
  if (!row) throw notFound('Món');
  return { context: publicCtx(ctx), row };
}

export async function alerts() {
  const ctx = await context();
  return (await buildRows(ctx)).map(stripLines).filter((r) => r.alert !== null || r.optionAlert !== null);
}
