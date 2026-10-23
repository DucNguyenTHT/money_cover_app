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

export interface OverheadMonth {
  /** "YYYY-MM" */
  month: string;
  overhead: Num;
  revenue: Num;
}

export interface OverheadChoice {
  /** Rate used for pricing, % of the selling price. */
  pct: string;
  /** Where the rate comes from: computed from recent months, or the manual value in Settings. */
  source: 'AUTO' | 'MANUAL';
  /** Months the automatic rate was computed from. */
  months: string[];
  /** What the owner should know about the rate (fallback reason, months used…). */
  note: string | null;
  /** The rate is suspicious (above 100 % of sales) and prices built on it are not reliable. */
  warn: boolean;
}

const pctVi = (v: Decimal.Value) => `${D(v).toDecimalPlaces(2).toString().replace('.', ',')}%`;
const monthsVi = (ms: string[]) => {
  const year = ms[0]!.slice(0, 4);
  return ms.every((m) => m.startsWith(year))
    ? `tháng ${ms.map((m) => Number(m.slice(5))).join(', ')}/${year}`
    : ms.map((m) => `${Number(m.slice(5))}/${m.slice(0, 4)}`).join(', ');
};

/**
 * Overhead rate for pricing. AUTO = overhead ÷ revenue of the recent months the shop sold for the WHOLE month
 * (a part-month after opening still carries a full month of rent and wages and would inflate the rate). With no
 * full month, or a rate above 100 % of sales, the manual rate is used instead and the note says why.
 */
export function chooseOverheadRate(args: {
  mode: 'AUTO' | 'MANUAL';
  manualPct: Num;
  /** First business date with a paid sale (null = nothing sold yet). */
  firstSale: string | null;
  /** Candidate months, oldest first. */
  months: readonly OverheadMonth[];
}): OverheadChoice {
  const manual = D(args.manualPct);
  const manualWarn = manual.gt(100);
  const useManual = (note: string | null, warn = false): OverheadChoice => ({
    pct: manual.toString(),
    source: 'MANUAL',
    months: [],
    note:
      [note, manualWarn ? `Tỷ lệ nhập tay ${pctVi(manual)} lớn hơn 100% doanh số — kiểm tra lại.` : null]
        .filter(Boolean)
        .join(' ') || null,
    warn: warn || manualWarn,
  });
  if (args.mode === 'MANUAL') return useManual(null);

  const full = args.months.filter(
    (m) => args.firstSale !== null && args.firstSale <= `${m.month}-01` && D(m.revenue).gt(0),
  );
  if (!full.length)
    return useManual(
      `Chưa có tháng nào bán trọn vẹn trong ${args.months.length} tháng gần nhất nên đang dùng tỷ lệ nhập tay ${pctVi(manual)}.`,
    );
  const overhead = full.reduce((s, m) => s.add(m.overhead), ZERO);
  const revenue = full.reduce((s, m) => s.add(m.revenue), ZERO);
  const rate = overheadRate(overhead, revenue)!;
  const used = full.map((m) => m.month);
  if (rate.gt(100))
    return useManual(
      `Tỷ lệ tự tính ra ${pctVi(rate)} (chi phí chung ${monthsVi(used)} lớn hơn doanh thu) nên đang dùng tỷ lệ nhập tay ${pctVi(manual)}. Kiểm tra lại chi phí chung đã nhập.`,
      true,
    );
  return {
    pct: rate.toString(),
    source: 'AUTO',
    months: used,
    note: `Tính từ ${monthsVi(used)}.`,
    warn: false,
  };
}

export type PriceAlertLevel = 'LOSS' | 'OVER_TARGET' | null;

/** LOSS when selling at or below direct cost (+ commission for apps); OVER_TARGET when food cost exceeds target + tolerance. */
export function priceAlert(c: ChannelCost, targetPct: Num, tolerancePct: Num): PriceAlertLevel {
  if (!c.price || c.foodCostPct === null) return null;
  if (c.directCost.add(c.commission).gte(c.price)) return 'LOSS';
  if (c.foodCostPct.gt(D(targetPct).add(tolerancePct))) return 'OVER_TARGET';
  return null;
}

export interface OptionPricingInput {
  /** Added to the dish price. */
  optionPrice: Num;
  /** Multiplies the dish recipe (size); 1 = an add-on. */
  recipeFactor: Num;
  /** Extra ingredients per portion: stock units, latest price per stock unit (null = never bought). */
  extras: readonly { qty: Num; unitPrice: Num | null }[];
  /** The dish in the store: direct cost of one portion, and its price (null = none yet). */
  dishCost: Num;
  dishPrice: Num | null;
  overheadPct: Num;
  targetPct: Num;
  tolerancePct: Num;
  step: Num;
}

export interface OptionPricing {
  kind: 'SIZE' | 'ADDON';
  /** What the option adds to the cost of the portion. */
  extraCost: Decimal;
  /** Judged as sold: the add-on alone, or the whole portion in that size (null when the dish has no price). */
  price: Decimal | null;
  cost: Decimal;
  profit: Decimal | null;
  foodCostPct: Decimal | null;
  /** Option price keeping the target food cost % on what it adds (null when it adds no cost). */
  suggested: Decimal | null;
  alert: PriceAlertLevel;
}

/**
 * Profit of a dish option at the latest purchase prices. An add-on (extra egg, extra meat) is judged on its own price
 * against its extra ingredients; a size (recipe × factor) on the whole portion in that size. Free options and
 * discounts (price ≤ 0) are never an alert.
 */
export function optionPricing(i: OptionPricingInput): OptionPricing {
  const extras = i.extras.reduce((s, e) => s.add(D(e.qty).mul(e.unitPrice ?? 0)), ZERO);
  const factor = D(i.recipeFactor);
  const size = !factor.eq(1);
  const extraCost = roundVnd(extras.add(factor.sub(1).mul(i.dishCost)));
  const price = size ? (i.dishPrice === null ? null : D(i.dishPrice).add(i.optionPrice)) : D(i.optionPrice);
  const cost = size ? roundVnd(D(i.dishCost).mul(factor).add(extras)) : extraCost;
  const sold = price !== null && price.gt(0);
  const foodCostPct = sold ? pct(cost, price) : null;
  const alert: PriceAlertLevel = !sold
    ? null
    : cost.gte(price)
      ? 'LOSS'
      : foodCostPct!.gt(D(i.targetPct).add(i.tolerancePct))
        ? 'OVER_TARGET'
        : null;
  return {
    kind: size ? 'SIZE' : 'ADDON',
    extraCost,
    price,
    cost,
    profit: price === null ? null : price.sub(cost).sub(roundVnd(price.mul(i.overheadPct).div(100))),
    foodCostPct,
    suggested: extraCost.gt(0) ? suggestStorePrice(extraCost, i.targetPct, i.step) : null,
    alert,
  };
}
