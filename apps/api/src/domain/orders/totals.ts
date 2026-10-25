import type { DiscountType, VatMode } from '../enums';
import { D, Decimal, ZERO, allocateVnd, roundVnd, sum, type Num } from '../money';

export interface TotalsLine {
  qty: Num;
  unitPrice: Num;
  /** Discount on this line (whole đồng). */
  discountAmount?: Num;
}

export interface TotalsInput {
  lines: readonly TotalsLine[];
  orderDiscount?: { type: DiscountType; value: Num } | null;
  /** Money off for loyalty points spent (after the order discount, capped at what is left). */
  pointsDiscount?: Num;
  /** 0 when the order's channel has no service charge. */
  serviceChargePct: Num;
  vatPct: Num;
  vatMode: VatMode;
}

export interface Totals {
  subtotal: Decimal;
  itemDiscountTotal: Decimal;
  orderDiscountAmount: Decimal;
  pointsDiscountAmount: Decimal;
  serviceChargeAmount: Decimal;
  /** Doanh thu thuần: after discounts, plus service charge, without VAT. */
  netRevenue: Decimal;
  vatAmount: Decimal;
  /** What the customer pays. */
  total: Decimal;
  /** Per line: amount, and net amount (after both discounts, without VAT, without service charge). */
  lines: { amount: Decimal; netAmount: Decimal }[];
}

/** VAT contained in a VAT-inclusive amount. */
const vatInside = (gross: Decimal, vatPct: Decimal) =>
  vatPct.isZero() ? ZERO : roundVnd(gross.mul(vatPct).div(D(100).add(vatPct)));

/**
 * Order totals, rounded to whole đồng at every step:
 * subtotal − line discounts − order discount − points = sales; + service charge; + VAT (EXCLUSIVE) or VAT taken out (INCLUSIVE).
 */
export function orderTotals(input: TotalsInput): Totals {
  const amounts = input.lines.map((l) => roundVnd(D(l.qty).mul(l.unitPrice)));
  const lineDiscounts = input.lines.map((l, i) => Decimal.min(roundVnd(l.discountAmount ?? 0), amounts[i]!));
  const afterLine = amounts.map((a, i) => a.sub(lineDiscounts[i]!));
  const subtotal = sum(amounts);
  const itemDiscountTotal = sum(lineDiscounts);
  const base = sum(afterLine);

  let orderDiscountAmount = ZERO;
  const od = input.orderDiscount;
  if (od) {
    orderDiscountAmount =
      od.type === 'PERCENT' ? roundVnd(base.mul(Decimal.min(D(od.value), 100)).div(100)) : roundVnd(od.value);
    orderDiscountAmount = Decimal.max(ZERO, Decimal.min(orderDiscountAmount, base));
  }
  const shares = allocateVnd(orderDiscountAmount, afterLine);
  const afterOrder = afterLine.map((a, i) => a.sub(shares[i] ?? 0));
  const pointsDiscountAmount = Decimal.max(
    ZERO,
    Decimal.min(roundVnd(input.pointsDiscount ?? 0), base.sub(orderDiscountAmount)),
  );
  const pointShares = allocateVnd(pointsDiscountAmount, afterOrder);
  const sales = base.sub(orderDiscountAmount).sub(pointsDiscountAmount);
  const serviceChargeAmount = roundVnd(sales.mul(input.serviceChargePct).div(100));
  const vatPct = D(input.vatPct);

  let netRevenue: Decimal;
  let vatAmount: Decimal;
  let total: Decimal;
  let netLines = afterOrder.map((a, i) => a.sub(pointShares[i] ?? 0));
  if (input.vatMode === 'INCLUSIVE') {
    total = sales.add(serviceChargeAmount);
    vatAmount = vatInside(total, vatPct);
    netRevenue = total.sub(vatAmount);
    // Line net amounts exclude VAT too, so dish profit adds up to net revenue minus service charge.
    const salesExVat = sales.sub(vatInside(sales, vatPct));
    netLines = allocateVnd(salesExVat, netLines);
  } else {
    netRevenue = sales.add(serviceChargeAmount);
    vatAmount = roundVnd(netRevenue.mul(vatPct).div(100));
    total = netRevenue.add(vatAmount);
  }

  return {
    subtotal,
    itemDiscountTotal,
    orderDiscountAmount,
    pointsDiscountAmount,
    serviceChargeAmount,
    netRevenue,
    vatAmount,
    total,
    lines: amounts.map((amount, i) => ({ amount, netAmount: netLines[i]! })),
  };
}

/** Share of the pre-discount subtotal given away, in percent (0 when nothing was sold). */
export function discountPct(
  t: Pick<Totals, 'subtotal' | 'itemDiscountTotal' | 'orderDiscountAmount'>,
): Decimal {
  if (t.subtotal.isZero()) return ZERO;
  return t.itemDiscountTotal.add(t.orderDiscountAmount).mul(100).div(t.subtotal);
}
