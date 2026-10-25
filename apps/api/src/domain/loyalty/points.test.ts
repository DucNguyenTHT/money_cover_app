import { describe, expect, it } from 'vitest';
import { orderTotals } from '../orders/totals';
import {
  earnedPoints,
  maxRedeemable,
  normalizePhone,
  pointsValue,
  redeemProblem,
  type LoyaltyRules,
} from './points';

const rules: LoyaltyRules = { earnVnd: 10000, pointValue: 500, minRedeem: 20, maxRedeemPct: 50 };

describe('loyalty points', () => {
  it('earns 1 point per 10.000 of net revenue, rounded down', () => {
    expect(earnedPoints('125900', 10000)).toBe(12);
    expect(earnedPoints('9999', 10000)).toBe(0);
    expect(earnedPoints('-5000', 10000)).toBe(0);
    expect(earnedPoints('50000', 0)).toBe(0);
  });

  it('spends points within the balance, the minimum and half the order', () => {
    expect(maxRedeemable(1000, '100000', rules)).toBe(100); // 50% of 100.000 = 50.000 = 100 points
    expect(maxRedeemable(30, '100000', rules)).toBe(30);
    expect(redeemProblem(0, 0, '100000', rules)).toBeNull();
    expect(redeemProblem(10, 100, '100000', rules)).toBe('Đổi tối thiểu 20 điểm');
    expect(redeemProblem(60, 50, '100000', rules)).toBe('Khách chỉ có 50 điểm');
    expect(redeemProblem(150, 1000, '100000', rules)).toContain('tối đa 100 điểm');
    expect(redeemProblem(100, 1000, '100000', rules)).toBeNull();
    expect(pointsValue(100, 500).toString()).toBe('50000');
  });

  it('normalises phone numbers', () => {
    expect(normalizePhone('+84 90-123 4567')).toBe('0901234567');
    expect(normalizePhone('0901234567')).toBe('0901234567');
    expect(normalizePhone('0283 8123 456')).toBe('02838123456');
    expect(normalizePhone('12345')).toBeNull();
  });
});

describe('order totals with points', () => {
  it('points come off after the order discount, before service charge and VAT; lines share them', () => {
    const t = orderTotals({
      lines: [
        { qty: 2, unitPrice: 60000 },
        { qty: 1, unitPrice: 30000 },
      ],
      orderDiscount: { type: 'PERCENT', value: 10 },
      pointsDiscount: 20000,
      serviceChargePct: 5,
      vatPct: 8,
      vatMode: 'EXCLUSIVE',
    });
    // 150.000 − 15.000 − 20.000 = 115.000; + 5% = 5.750 → 120.750; VAT 8% = 9.660.
    expect(t.orderDiscountAmount.toString()).toBe('15000');
    expect(t.pointsDiscountAmount.toString()).toBe('20000');
    expect(t.serviceChargeAmount.toString()).toBe('5750');
    expect(t.netRevenue.toString()).toBe('120750');
    expect(t.total.toString()).toBe('130410');
    expect(t.lines.reduce((s, l) => s + Number(l.netAmount), 0)).toBe(115000);
  });

  it('never takes more than what is left', () => {
    const t = orderTotals({
      lines: [{ qty: 1, unitPrice: 10000 }],
      pointsDiscount: 50000,
      serviceChargePct: 0,
      vatPct: 0,
      vatMode: 'EXCLUSIVE',
    });
    expect(t.pointsDiscountAmount.toString()).toBe('10000');
    expect(t.total.toString()).toBe('0');
  });
});
