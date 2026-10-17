import type { Channel, IngredientKind, RecipeScope } from '../enums';
import { D, Decimal, ZERO, roundUpTo, roundVnd, type Num } from '../money';
import { scopeApplies } from '../recipes/recipes';

export interface CostLine {
  ingredientId: number;
  kind: IngredientKind;
  scope: RecipeScope;
  /** Per portion, stock units. */
  qty: Num;
  /** Latest purchase price per stock unit (null = never purchased). */
  unitPrice: Num | null;
}

export interface ChannelCost {
  channel: Channel;
  price: Decimal | null;
  ingredientCost: Decimal;
  packagingCost: Decimal;
  directCost: Decimal;
  commission: Decimal;
  overhead: Decimal;
  totalCost: Decimal;
  /** null when there is no selling price. */
  profit: Decimal | null;
  profitPct: Decimal | null;
  foodCostPct: Decimal | null;
}

export interface CostSheetInput {
  lines: readonly CostLine[];
  storePrice: Num | null;
  appPrice: Num | null;
  /** Commission of the app used for the app column, in %. */
  appCommissionPct: Num;
  /** Overhead as % of the selling price. */
  overheadPct: Num;
}

const pct = (part: Decimal, whole: Decimal) =>
  whole.isZero() ? null : part.div(whole).mul(100).toDecimalPlaces(1);

function channelCost(input: CostSheetInput, channel: Channel): ChannelCost {
  let ing = ZERO;
  let pack = ZERO;
  for (const l of input.lines) {
    if (!scopeApplies(l.scope, channel)) continue;
    const c = D(l.qty).mul(l.unitPrice ?? 0);
    if (l.kind === 'PACKAGING') pack = pack.add(c);
    else ing = ing.add(c);
  }
  const priceRaw = channel === 'APP' ? input.appPrice : input.storePrice;
  const price = priceRaw === null || priceRaw === undefined ? null : D(priceRaw);
  const direct = roundVnd(ing.add(pack));
  const commission = channel === 'APP' && price ? roundVnd(price.mul(input.appCommissionPct).div(100)) : ZERO;
  const overhead = price ? roundVnd(price.mul(input.overheadPct).div(100)) : ZERO;
  const total = direct.add(commission).add(overhead);
  return {
    channel,
    price,
    ingredientCost: roundVnd(ing),
    packagingCost: roundVnd(pack),
    directCost: direct,
    commission,
    overhead,
    totalCost: total,
    profit: price ? price.sub(total) : null,
    profitPct: price ? pct(price.sub(total), price) : null,
    foodCostPct: price ? pct(direct, price) : null,
  };
}

/** Cost of one portion in each channel at the latest purchase prices. */
export function costSheet(input: CostSheetInput): Record<Channel, ChannelCost> {
  return {
    DINE_IN: channelCost(input, 'DINE_IN'),
    TAKEAWAY: channelCost(input, 'TAKEAWAY'),
    APP: channelCost(input, 'APP'),
  };
}

/** Store price so that direct cost / price = target food-cost %, rounded up to `step`. */
export function suggestStorePrice(directCost: Num, targetPct: Num, step: Num): Decimal | null {
  const t = D(targetPct);
  if (t.lte(0)) return null;
  return roundUpTo(D(directCost).mul(100).div(t), step);
}

/**
 * App price that keeps the same net profit per portion as selling in the store, after commission,
 * overhead and app packaging: (P·(1−oh) − cost_store + cost_app) / (1 − oh − comm).
 */
export function suggestAppPrice(args: {
  storePrice: Num;
  storeDirect: Num;
  appDirect: Num;
  overheadPct: Num;
  commissionPct: Num;
  step: Num;
}): Decimal | null {
  const oh = D(args.overheadPct).div(100);
  const comm = D(args.commissionPct).div(100);
  const denom = D(1).sub(oh).sub(comm);
  if (denom.lte(0)) return null;
  const raw = D(args.storePrice).mul(D(1).sub(oh)).sub(args.storeDirect).add(args.appDirect).div(denom);
  return roundUpTo(raw, args.step);
}

/** Overhead rate (% of revenue) from recent months; null when there is no revenue. */
export function overheadRate(overheadTotal: Num, revenueTotal: Num): Decimal | null {
  const r = D(revenueTotal);
  return r.lte(0) ? null : D(overheadTotal).div(r).mul(100).toDecimalPlaces(2);
}

export type PriceAlertLevel = 'LOSS' | 'OVER_TARGET' | null;

/** LOSS when selling at or below direct cost (+ commission for apps); OVER_TARGET when food cost exceeds target + tolerance. */
export function priceAlert(c: ChannelCost, targetPct: Num, tolerancePct: Num): PriceAlertLevel {
  if (!c.price || c.foodCostPct === null) return null;
  if (c.directCost.add(c.commission).gte(c.price)) return 'LOSS';
  if (c.foodCostPct.gt(D(targetPct).add(tolerancePct))) return 'OVER_TARGET';
  return null;
}
