import { describe, expect, it } from 'vitest';
import { optionPricing } from './pricing';

const base = {
  extras: [],
  dishCost: 20000,
  dishPrice: 50000,
  overheadPct: 10,
  targetPct: 35,
  tolerancePct: 2,
  step: 1000,
};
const n = (d: { toNumber(): number } | null) => (d === null ? null : d.toNumber());

describe('option pricing', () => {
  it('an add-on is judged on its own price against its extra ingredients', () => {
    const egg = optionPricing({
      ...base,
      optionPrice: 5000,
      recipeFactor: 1,
      extras: [{ qty: 1, unitPrice: 3500 }],
    });
    expect([egg.kind, n(egg.cost), n(egg.foodCostPct), egg.alert]).toEqual([
      'ADDON',
      3500,
      70,
      'OVER_TARGET',
    ]);
    expect(n(egg.profit)).toBe(1000);
    expect(n(egg.suggested)).toBe(10000);
    const beef = optionPricing({
      ...base,
      optionPrice: 10000,
      recipeFactor: 1,
      extras: [{ qty: 0.05, unitPrice: 260000 }],
    });
    expect([n(beef.cost), beef.alert]).toEqual([13000, 'LOSS']);
  });

  it('a size is judged on the whole portion; free options and discounts never alert', () => {
    const large = optionPricing({ ...base, optionPrice: 10000, recipeFactor: 1.5 });
    expect([
      large.kind,
      n(large.extraCost),
      n(large.price),
      n(large.cost),
      n(large.foodCostPct),
      large.alert,
    ]).toEqual(['SIZE', 10000, 60000, 30000, 50, 'OVER_TARGET']);
    expect(n(large.suggested)).toBe(29000);
    const small = optionPricing({ ...base, optionPrice: -5000, recipeFactor: 0.8 });
    expect([n(small.extraCost), n(small.cost), n(small.foodCostPct), small.alert, small.suggested]).toEqual([
      -4000,
      16000,
      35.6,
      null,
      null,
    ]);
    // Too big a discount for what the small size saves.
    expect(optionPricing({ ...base, optionPrice: -15000, recipeFactor: 0.8 }).alert).toBe('OVER_TARGET');
    const free = optionPricing({
      ...base,
      optionPrice: 0,
      recipeFactor: 1,
      extras: [{ qty: 1, unitPrice: 500 }],
    });
    expect([free.alert, n(free.profit)]).toEqual([null, -500]);
    const noPrice = optionPricing({ ...base, dishPrice: null, optionPrice: 10000, recipeFactor: 1.5 });
    expect([noPrice.price, noPrice.alert]).toEqual([null, null]);
  });
});
