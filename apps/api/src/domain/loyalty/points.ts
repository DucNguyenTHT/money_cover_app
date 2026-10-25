// Loyalty points of regular customers (khách quen): earned on what they pay, spent as money off a later order.
import { D, Decimal, ZERO, type Num } from '../money';

export interface LoyaltyRules {
  /** Đồng of net revenue per point earned (10.000 → 1 point). */
  earnVnd: number;
  /** Đồng off per point spent. */
  pointValue: number;
  /** Fewest points that can be spent at once. */
  minRedeem: number;
  /** At most this % of the order (after discounts) can be paid with points. */
  maxRedeemPct: number;
}

/** Points earned on an order's net revenue (whole points, rounded down). */
export function earnedPoints(netRevenue: Num, earnVnd: number): number {
  if (earnVnd <= 0) return 0;
  const n = D(netRevenue);
  return n.lte(0) ? 0 : n.div(earnVnd).floor().toNumber();
}

/** Most points usable on an order whose amount after discounts is `base`. */
export function maxRedeemable(balance: number, base: Num, r: LoyaltyRules): number {
  if (r.pointValue <= 0 || balance <= 0) return 0;
  const cap = D(base).mul(r.maxRedeemPct).div(100).div(r.pointValue).floor().toNumber();
  return Math.max(0, Math.min(balance, cap));
}

/** Why `points` cannot be spent (null = fine). */
export function redeemProblem(points: number, balance: number, base: Num, r: LoyaltyRules): string | null {
  if (!Number.isInteger(points) || points < 0) return 'Số điểm không hợp lệ';
  if (points === 0) return null;
  if (points < r.minRedeem) return `Đổi tối thiểu ${r.minRedeem} điểm`;
  if (points > balance) return `Khách chỉ có ${balance} điểm`;
  const max = maxRedeemable(balance, base, r);
  if (points > max) return `Đơn này dùng tối đa ${max} điểm (${r.maxRedeemPct}% giá trị đơn)`;
  return null;
}

/** Money off for `points`. */
export const pointsValue = (points: number, pointValue: number): Decimal =>
  points > 0 && pointValue > 0 ? D(points).mul(pointValue) : ZERO;

/** Vietnamese mobile / landline as digits starting with 0 ("+84 90-123 4567" → "0901234567"); null if not a phone. */
export function normalizePhone(s: string): string | null {
  let d = s.replace(/\D/g, '');
  if (d.startsWith('84') && d.length >= 11) d = `0${d.slice(2)}`;
  return /^0\d{8,10}$/.test(d) ? d : null;
}
