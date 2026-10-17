import type { PaymentMethod } from '../enums';
import { D, Decimal, ZERO, roundVnd, sum, type Num } from '../money';

export interface PaymentInput {
  method: PaymentMethod;
  amount: Num;
  /** Cash only: what the customer handed over. */
  cashReceived?: Num | null;
}

export interface CheckedPayment {
  method: PaymentMethod;
  amount: Decimal;
  cashReceived: Decimal | null;
  change: Decimal | null;
}

/** Validate a (possibly split) payment against the order total. Returns an error message or the normalized lines. */
export function checkPayments(
  total: Num,
  payments: readonly PaymentInput[],
): { error: string } | { lines: CheckedPayment[] } {
  if (!payments.length) return { error: 'Chọn hình thức thanh toán' };
  const lines: CheckedPayment[] = [];
  for (const p of payments) {
    const amount = roundVnd(p.amount);
    if (amount.lte(0)) return { error: 'Số tiền thanh toán phải lớn hơn 0' };
    if (p.method === 'CASH') {
      const received = p.cashReceived == null ? amount : roundVnd(p.cashReceived);
      if (received.lt(amount)) return { error: 'Tiền khách đưa ít hơn số tiền mặt cần trả' };
      lines.push({ method: p.method, amount, cashReceived: received, change: received.sub(amount) });
    } else {
      lines.push({ method: p.method, amount, cashReceived: null, change: null });
    }
  }
  const paid = sum(lines.map((l) => l.amount));
  const t = roundVnd(total);
  if (!paid.eq(t)) {
    return {
      error: `Tổng thanh toán ${paid.toNumber().toLocaleString('vi-VN')} khác số tiền cần trả ${t.toNumber().toLocaleString('vi-VN')}`,
    };
  }
  return { lines };
}

/** Quick cash buttons: the exact amount, then the next round notes above it. */
export function cashSuggestions(total: Num): Decimal[] {
  const t = roundVnd(total);
  if (t.lte(0)) return [];
  const out = [t];
  for (const step of [10_000, 50_000, 100_000, 200_000, 500_000]) {
    const v = t.div(step).toDecimalPlaces(0, Decimal.ROUND_CEIL).mul(step);
    if (!out.some((x) => x.eq(v))) out.push(v);
  }
  return out.slice(0, 5);
}

export const changeDue = (total: Num, received: Num): Decimal => Decimal.max(ZERO, D(received).sub(total));
