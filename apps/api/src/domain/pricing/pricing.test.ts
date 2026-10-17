import { describe, expect, it } from 'vitest';
import { costSheet, overheadRate, priceAlert, suggestAppPrice, suggestStorePrice } from './pricing';
import { consumption, pickVersion, recipeToStock } from '../recipes/recipes';

// Phở: 0,2 kg thịt @120.000 + 0,2 kg bánh @20.000 = 28.000; takeaway/app box 2.000
const pho = [
  { ingredientId: 1, kind: 'INGREDIENT' as const, scope: 'ALL' as const, qty: '0.2', unitPrice: 120000 },
  { ingredientId: 2, kind: 'INGREDIENT' as const, scope: 'ALL' as const, qty: '0.2', unitPrice: 20000 },
  { ingredientId: 3, kind: 'PACKAGING' as const, scope: 'TAKEAWAY_APP' as const, qty: '1', unitPrice: 2000 },
];

describe('costSheet', () => {
  const sheet = costSheet({
    lines: pho,
    storePrice: 80000,
    appPrice: 114000,
    appCommissionPct: 25,
    overheadPct: 10,
  });

  it('excludes packaging at the table and adds it for takeaway / app', () => {
    expect(sheet.DINE_IN.directCost.toNumber()).toBe(28000);
    expect(sheet.TAKEAWAY.directCost.toNumber()).toBe(30000);
    expect(sheet.APP.packagingCost.toNumber()).toBe(2000);
  });

  it('computes commission, overhead and profit per portion', () => {
    expect(sheet.DINE_IN.overhead.toNumber()).toBe(8000);
    expect(sheet.DINE_IN.profit!.toNumber()).toBe(44000);
    expect(sheet.DINE_IN.foodCostPct!.toNumber()).toBe(35);
    expect(sheet.APP.commission.toNumber()).toBe(28500);
    expect(sheet.APP.overhead.toNumber()).toBe(11400);
    expect(sheet.APP.profit!.toNumber()).toBe(44100);
  });
});

describe('suggestions', () => {
  it('store price from target food cost, rounded up: 28.000 at 35% → 80.000', () => {
    expect(suggestStorePrice(28000, 35, 1000)!.toNumber()).toBe(80000);
    expect(suggestStorePrice(30000, 35, 1000)!.toNumber()).toBe(86000);
  });

  it('app price keeps the store profit per portion → 114.000', () => {
    const p = suggestAppPrice({
      storePrice: 80000,
      storeDirect: 28000,
      appDirect: 30000,
      overheadPct: 10,
      commissionPct: 25,
      step: 1000,
    });
    expect(p!.toNumber()).toBe(114000);
  });

  it('overhead rate from recent months', () => {
    expect(overheadRate(30_000_000, 300_000_000)!.toNumber()).toBe(10);
    expect(overheadRate(1, 0)).toBeNull();
  });
});

describe('priceAlert', () => {
  it('flags losses before over-target', () => {
    const loss = costSheet({
      lines: [{ ingredientId: 1, kind: 'INGREDIENT', scope: 'ALL', qty: 1, unitPrice: 41000 }],
      storePrice: 39000,
      appPrice: null,
      appCommissionPct: 0,
      overheadPct: 0,
    });
    expect(priceAlert(loss.DINE_IN, 35, 2)).toBe('LOSS');
    expect(loss.DINE_IN.profit!.toNumber()).toBe(-2000);
    const high = costSheet({
      lines: [{ ingredientId: 1, kind: 'INGREDIENT', scope: 'ALL', qty: 1, unitPrice: 40000 }],
      storePrice: 100000,
      appPrice: null,
      appCommissionPct: 0,
      overheadPct: 0,
    });
    expect(priceAlert(high.DINE_IN, 35, 2)).toBe('OVER_TARGET');
    expect(priceAlert(high.DINE_IN, 40, 2)).toBeNull();
  });
});

describe('recipes', () => {
  it('picks the version in force on a date', () => {
    const v = [
      { effectiveFrom: '2026-09-01', id: 1 },
      { effectiveFrom: '2026-10-05', id: 2 },
    ];
    expect(pickVersion(v, '2026-10-04')?.id).toBe(1);
    expect(pickVersion(v, '2026-10-05')?.id).toBe(2);
    expect(pickVersion(v, '2026-08-31')).toBeUndefined();
  });

  it('sums usage per ingredient and applies packaging only off-premises', () => {
    const recipe = pho.map(({ ingredientId, qty, scope }) => ({ ingredientId, qty, scope }));
    const use = consumption([
      { qty: 10, channel: 'DINE_IN', recipe },
      { qty: 5, channel: 'APP', recipe },
    ]);
    expect(use.get(1)!.toNumber()).toBe(3);
    expect(use.get(3)!.toNumber()).toBe(5);
  });

  it('converts recipe units to stock units', () => {
    expect(recipeToStock(200, 1000).toNumber()).toBe(0.2);
  });
});
