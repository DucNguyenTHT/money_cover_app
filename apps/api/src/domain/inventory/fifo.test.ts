import { describe, expect, it } from 'vitest';
import { allocateFifo, allocationsCost, settlePending, toStockUnits } from './fifo';

const lots = [
  { id: 1, qtyRemaining: 10, unitPrice: 100 },
  { id: 2, qtyRemaining: 10, unitPrice: 120 },
];

describe('allocateFifo', () => {
  it('takes the oldest lot first: 15 kg from 10@100 + 10@120 costs 1.600', () => {
    const r = allocateFifo(lots, 15);
    expect(r.allocations.map((a) => [a.lotId, a.qty.toNumber()])).toEqual([
      [1, 10],
      [2, 5],
    ]);
    expect(r.allocatedCost.toNumber()).toBe(1600);
    expect(r.shortQty.toNumber()).toBe(0);
  });

  it('reports the uncovered part as shortQty (nợ kho)', () => {
    const r = allocateFifo(lots, 25);
    expect(r.allocatedCost.toNumber()).toBe(2200);
    expect(r.shortQty.toNumber()).toBe(5);
  });

  it('skips empty lots and handles fractional quantities exactly', () => {
    const r = allocateFifo(
      [
        { id: 1, qtyRemaining: 0, unitPrice: 100 },
        { id: 2, qtyRemaining: '0.35', unitPrice: '264000' },
      ],
      '0.2',
    );
    expect(r.allocations).toHaveLength(1);
    expect(r.allocatedCost.toNumber()).toBe(52800);
  });

  it('rejects negative quantities', () => {
    expect(() => allocateFifo(lots, -1)).toThrow();
  });
});

describe('allocationsCost', () => {
  it('rounds the total to whole đồng', () => {
    expect(allocationsCost([{ qty: '0.333', unitPrice: 1000 }]).toNumber()).toBe(333);
  });
});

describe('settlePending', () => {
  it('covers older debts first and keeps the rest of the lot', () => {
    const r = settlePending(8, [
      { issueItemId: 11, pendingQty: 3 },
      { issueItemId: 12, pendingQty: 4 },
    ]);
    expect(r.settlements.map((s) => [s.issueItemId, s.qty.toNumber()])).toEqual([
      [11, 3],
      [12, 4],
    ]);
    expect(r.lotLeft.toNumber()).toBe(1);
  });

  it('partially settles when the lot is too small', () => {
    const r = settlePending(2, [{ issueItemId: 11, pendingQty: 3 }]);
    expect(r.settlements[0]!.qty.toNumber()).toBe(2);
    expect(r.lotLeft.toNumber()).toBe(0);
  });
});

describe('toStockUnits', () => {
  it('2 thùng × 24 lon at 240.000/thùng → 48 lon at 10.000/lon', () => {
    const r = toStockUnits(2, 240000, 24);
    expect(r.qty.toNumber()).toBe(48);
    expect(r.unitPrice.toNumber()).toBe(10000);
  });
});
