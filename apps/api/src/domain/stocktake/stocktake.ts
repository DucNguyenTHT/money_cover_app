import { D, Decimal, ZERO, allocateVnd, type Num } from '../money';

/** Counted minus book: negative = shortage (thiếu), positive = surplus (thừa). */
export function variance(bookQty: Num, actualQty: Num) {
  const diff = D(actualQty).sub(bookQty);
  return { diff, shortage: diff.lt(0) ? diff.neg() : ZERO, surplus: diff.gt(0) ? diff : ZERO };
}

export interface DishUsage {
  dishId: number;
  /** How much of the ingredient the dish used in the period (stock units). */
  qty: Num;
}

/**
 * Spread a stocktake loss (positive = shortage cost, negative = surplus gain) over the dishes that
 * used the ingredient since the previous stocktake, in proportion to their usage. With no usage the
 * whole value is "hao hụt chung" (dishId null). Shares are whole đồng and add up exactly.
 */
export function allocateLoss(
  lossValue: Num,
  usage: readonly DishUsage[],
): { dishId: number | null; usageQty: Decimal; value: Decimal }[] {
  const used = usage.filter((u) => D(u.qty).gt(0));
  if (D(lossValue).isZero()) return [];
  if (!used.length) return [{ dishId: null, usageQty: ZERO, value: D(lossValue) }];
  const shares = allocateVnd(
    lossValue,
    used.map((u) => u.qty),
  );
  return used.map((u, i) => ({ dishId: u.dishId, usageQty: D(u.qty), value: shares[i]! }));
}
