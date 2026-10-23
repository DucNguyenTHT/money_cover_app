import { describe, expect, it } from 'vitest';
import { reorder } from './reorder';

const base = { onHand: 10, pending: 0, minStock: null, dailyUse: 2, days: 3, purchaseFactor: 1 };

describe('reorder', () => {
  it('enough stock: OK, nothing to buy', () => {
    expect(reorder(base)).toMatchObject({ status: 'OK', daysLeft: 5 });
    expect(reorder(base).suggest.toNumber()).toBe(0);
  });

  it('below the minimum: buy up to the larger of minimum and N days of use', () => {
    const r = reorder({ ...base, onHand: 4, minStock: 5 });
    expect(r.status).toBe('LOW');
    expect(r.daysLeft).toBe(2);
    expect(r.suggest.toNumber()).toBe(2); // 3 days × 2 = 6 − 4
  });

  it('runs out within N days even without a minimum', () => {
    expect(reorder({ ...base, onHand: 5 })).toMatchObject({ status: 'LOW', daysLeft: 2.5 });
  });

  it('nợ kho counts against stock; rounds up to whole purchase units', () => {
    const r = reorder({ ...base, onHand: 0, pending: 3, purchaseFactor: 24 });
    expect(r.status).toBe('OUT');
    expect(r.daysLeft).toBe(0);
    // Need 6 + 3 = 9 stock units → 1 carton of 24.
    expect(r.suggestPurchase.toNumber()).toBe(1);
    expect(r.suggest.toNumber()).toBe(24);
  });

  it('unused, no minimum: never flagged', () => {
    expect(reorder({ ...base, onHand: 0, dailyUse: 0 })).toMatchObject({ status: 'OK', daysLeft: null });
  });
});
