import { describe, expect, it } from 'vitest';
import { discountPct, orderTotals } from './totals';
import { cashSuggestions, checkPayments } from './payment';
import { cancelRule, orderCode } from './cancel-policy';
import { itemCosts } from './item-cost';
import { D } from '../money';

const n = (d: { toNumber(): number }) => d.toNumber();

describe('orderTotals', () => {
  it('service charge then exclusive VAT (plan example)', () => {
    const t = orderTotals({
      lines: [{ qty: 4, unitPrice: 50000 }],
      serviceChargePct: 5,
      vatPct: 8,
      vatMode: 'EXCLUSIVE',
    });
    expect(n(t.netRevenue)).toBe(210000);
    expect(n(t.serviceChargeAmount)).toBe(10000);
    expect(n(t.vatAmount)).toBe(16800);
    expect(n(t.total)).toBe(226800);
  });

  it('takeaway has no service charge', () => {
    const t = orderTotals({
      lines: [{ qty: 4, unitPrice: 50000 }],
      serviceChargePct: 0,
      vatPct: 8,
      vatMode: 'EXCLUSIVE',
    });
    expect(n(t.total)).toBe(216000);
  });

  it('inclusive VAT is taken out of the price', () => {
    const t = orderTotals({
      lines: [{ qty: 1, unitPrice: 108000 }],
      serviceChargePct: 0,
      vatPct: 8,
      vatMode: 'INCLUSIVE',
    });
    expect(n(t.total)).toBe(108000);
    expect(n(t.vatAmount)).toBe(8000);
    expect(n(t.netRevenue)).toBe(100000);
    expect(n(t.lines[0]!.netAmount)).toBe(100000);
  });

  it('order discount 10% spreads over lines and sums exactly', () => {
    const t = orderTotals({
      lines: [
        { qty: 2, unitPrice: 60000 },
        { qty: 1, unitPrice: 50000 },
        { qty: 3, unitPrice: 3333 },
      ],
      orderDiscount: { type: 'PERCENT', value: 10 },
      serviceChargePct: 0,
      vatPct: 0,
      vatMode: 'EXCLUSIVE',
    });
    expect(n(t.subtotal)).toBe(179999);
    expect(n(t.orderDiscountAmount)).toBe(18000);
    expect(t.lines.reduce((s, l) => s + n(l.netAmount), 0)).toBe(n(t.netRevenue));
    expect(n(t.lines[0]!.netAmount)).toBe(108000);
  });

  it('line discount then amount discount, never below zero', () => {
    const t = orderTotals({
      lines: [{ qty: 1, unitPrice: 50000, discountAmount: 10000 }],
      orderDiscount: { type: 'AMOUNT', value: 999999 },
      serviceChargePct: 0,
      vatPct: 0,
      vatMode: 'EXCLUSIVE',
    });
    expect(n(t.itemDiscountTotal)).toBe(10000);
    expect(n(t.orderDiscountAmount)).toBe(40000);
    expect(n(t.total)).toBe(0);
    expect(n(discountPct(t))).toBe(100);
  });
});

describe('payments', () => {
  it('split cash + transfer with change', () => {
    const r = checkPayments(216000, [
      { method: 'CASH', amount: 116000, cashReceived: 200000 },
      { method: 'TRANSFER', amount: 100000 },
    ]);
    expect('lines' in r && n(r.lines[0]!.change!)).toBe(84000);
  });
  it('rejects a total mismatch', () => {
    expect(checkPayments(216000, [{ method: 'CASH', amount: 200000 }])).toHaveProperty('error');
  });
  it('rejects too little cash received', () => {
    expect(checkPayments(50000, [{ method: 'CASH', amount: 50000, cashReceived: 20000 }])).toHaveProperty(
      'error',
    );
  });
  it('quick cash amounts', () => {
    expect(cashSuggestions(216000).map(n)).toEqual([216000, 220000, 250000, 300000, 400000]);
  });
});

describe('cancel rules', () => {
  const base = { orderDate: '2026-10-12', today: '2026-10-12', dayClosed: false } as const;
  it('staff can cancel open and today-paid orders', () => {
    expect(cancelRule({ ...base, status: 'OPEN', role: 'STAFF' })).toBe('ALLOWED');
    expect(cancelRule({ ...base, status: 'PAID', role: 'STAFF' })).toBe('ALLOWED');
  });
  it('staff needs an admin for earlier days or closed days', () => {
    expect(cancelRule({ ...base, status: 'PAID', role: 'STAFF', orderDate: '2026-10-11' })).toBe(
      'NEEDS_ADMIN',
    );
    expect(cancelRule({ ...base, status: 'PAID', role: 'STAFF', dayClosed: true })).toBe('NEEDS_ADMIN');
    expect(cancelRule({ ...base, status: 'PAID', role: 'ADMIN', orderDate: '2026-10-01' })).toBe('ALLOWED');
  });
  it('order code', () => expect(orderCode('2026-10-12', 7)).toBe('261012-007'));
});

describe('itemCosts', () => {
  it('shares ingredient cost by usage and sums to the issue cost', () => {
    const lines = [
      new Map([[1, D(2)]]),
      new Map([
        [1, D(1)],
        [2, D(0.5)],
      ]),
    ];
    const costs = itemCosts(
      lines,
      new Map([
        [1, 1000],
        [2, 301],
      ]),
    );
    expect(costs.map(n)).toEqual([667, 634]);
  });
});
