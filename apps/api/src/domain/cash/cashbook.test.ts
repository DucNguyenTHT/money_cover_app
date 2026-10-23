import { describe, expect, it } from 'vitest';
import { canCancelCash, cashTotals, expectedCash } from './cashbook';

describe('cash book', () => {
  const lines = [
    { direction: 'IN' as const, amount: 500000, cancelled: false }, // float
    { direction: 'OUT' as const, amount: 320000, cancelled: false }, // market
    { direction: 'OUT' as const, amount: 99999, cancelled: true },
  ];

  it('adds money in, takes money out, ignores cancelled entries', () => {
    const t = cashTotals(lines);
    expect([t.in.toNumber(), t.out.toNumber()]).toEqual([500000, 320000]);
    expect(expectedCash(2_000_000, lines).toNumber()).toBe(2_180_000);
  });

  it('who may cancel', () => {
    const base = { role: 'STAFF' as const, isAuthor: true, sameDay: true, automatic: false };
    expect(canCancelCash(base)).toBeNull();
    expect(canCancelCash({ ...base, sameDay: false })).toContain('Chỉ người ghi');
    expect(canCancelCash({ ...base, isAuthor: false })).toContain('Chỉ người ghi');
    expect(canCancelCash({ ...base, role: 'ADMIN', isAuthor: false, sameDay: false })).toBeNull();
    expect(canCancelCash({ ...base, role: 'ADMIN', automatic: true })).toContain('màn hình khác');
  });
});
