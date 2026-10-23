// "Cần nhập hàng": how long the stock lasts at the recent pace, and how much to buy.
import { D, Decimal, ZERO, type Num } from '../money';

export type StockStatus = 'OUT' | 'LOW' | 'OK';

export interface ReorderInput {
  /** Stock on hand (stock units). */
  onHand: Num;
  /** Sold before it was received ("nợ kho"): already owed out of the next receipt. */
  pending: Num;
  /** Minimum to keep; null = none set. */
  minStock: Num | null;
  /** Average use per day over the recent window. */
  dailyUse: Num;
  /** Buy enough for this many days. */
  days: number;
  /** 1 purchase unit (thùng, bao…) = this many stock units; 1 = buy in stock units. */
  purchaseFactor: Num;
}

export interface ReorderResult {
  status: StockStatus;
  /** Days the usable stock lasts at the recent pace; null = no recent use. */
  daysLeft: number | null;
  /** Suggested purchase, stock units (whole purchase units when there is one). */
  suggest: Decimal;
  /** Same in purchase units (equal to `suggest` when the factor is 1). */
  suggestPurchase: Decimal;
}

export function reorder(i: ReorderInput): ReorderResult {
  const usable = D(i.onHand).sub(i.pending);
  const use = D(i.dailyUse);
  const daysLeft = use.gt(0) ? Math.floor(Decimal.max(usable, 0).div(use).toNumber() * 10) / 10 : null;
  const target = Decimal.max(i.minStock === null ? ZERO : D(i.minStock), use.mul(i.days));
  const missing = Decimal.max(target.sub(usable), 0);
  const factor = D(i.purchaseFactor).gt(0) ? D(i.purchaseFactor) : D(1);
  const purchase = missing.isZero() ? ZERO : missing.div(factor).ceil();
  const status: StockStatus =
    usable.lte(0) && (use.gt(0) || i.minStock !== null)
      ? 'OUT'
      : (i.minStock !== null && usable.lt(i.minStock)) || (daysLeft !== null && daysLeft < i.days)
        ? 'LOW'
        : 'OK';
  return {
    status,
    daysLeft,
    suggest: status === 'OK' ? ZERO : purchase.mul(factor),
    suggestPurchase: status === 'OK' ? ZERO : purchase,
  };
}
