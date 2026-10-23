import { describe, expect, it } from 'vitest';
import { allocatePayments } from './payables';

const receipts = [
  { id: 1, date: '2026-10-01', amount: 1_000_000 },
  { id: 2, date: '2026-10-05', amount: 500_000 },
  { id: 3, date: '2026-10-03', amount: 300_000 },
];
const paidOf = (r: ReturnType<typeof allocatePayments>) =>
  Object.fromEntries([...r.paid].map(([id, v]) => [id, v.toNumber()]));

describe('allocatePayments', () => {
  it('pays the oldest receipts first', () => {
    const r = allocatePayments(receipts, [{ amount: 1_200_000, receiptId: null }]);
    expect(paidOf(r)).toEqual({ 1: 1_000_000, 2: 0, 3: 200_000 });
    expect(r.advance.toNumber()).toBe(0);
  });

  it('a payment for a receipt goes to it first, the excess to the oldest', () => {
    const r = allocatePayments(receipts, [{ amount: 600_000, receiptId: 2 }]);
    expect(paidOf(r)).toEqual({ 1: 100_000, 2: 500_000, 3: 0 });
  });

  it('money beyond every receipt is an advance', () => {
    const r = allocatePayments(receipts, [
      { amount: 1_000_000, receiptId: 1 },
      { amount: 1_000_000, receiptId: 99 },
    ]);
    expect(paidOf(r)).toEqual({ 1: 1_000_000, 2: 500_000, 3: 300_000 });
    expect(r.advance.toNumber()).toBe(200_000);
  });
});
