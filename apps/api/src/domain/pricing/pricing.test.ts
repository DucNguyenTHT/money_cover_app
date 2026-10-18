import { describe, expect, it } from 'vitest';
import {
  chooseOverheadRate,
  costSheet,
  overheadRate,
  priceAlert,
  suggestAppPrice,
  suggestStorePrice,
} from './pricing';
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

describe('chooseOverheadRate', () => {
  const months = [
    { month: '2026-07', overhead: 30_000_000, revenue: 0 },
    { month: '2026-08', overhead: 30_000_000, revenue: 15_000_000 }, // opened 25/8: 6 days of sales
    { month: '2026-09', overhead: 30_000_000, revenue: 300_000_000 },
  ];
  const base = { mode: 'AUTO' as const, manualPct: 12 };

  it('uses only the months sold in full (not the opening month)', () => {
    const r = chooseOverheadRate({ ...base, firstSale: '2026-08-25', months });
    expect(r).toMatchObject({ pct: '10', source: 'AUTO', months: ['2026-09'], warn: false });
    expect(r.note).toBe('Tính từ tháng 9/2026.');
  });

  it('falls back to the manual rate with no full month', () => {
    const r = chooseOverheadRate({ ...base, firstSale: '2026-09-10', months });
    expect(r).toMatchObject({ pct: '12', source: 'MANUAL', warn: false });
    expect(r.note).toContain('Chưa có tháng nào bán trọn vẹn');
  });

  it('falls back and warns when overhead is above sales', () => {
    const r = chooseOverheadRate({
      ...base,
      firstSale: '2026-01-01',
      months: [{ month: '2026-09', overhead: 60_000_000, revenue: 29_000_000 }],
    });
    expect(r).toMatchObject({ pct: '12', source: 'MANUAL', warn: true });
    expect(r.note).toContain('Tỷ lệ tự tính ra 206,9%');
  });

  it('warns about a manual rate above 100 %', () => {
    const r = chooseOverheadRate({ mode: 'MANUAL', manualPct: 150, firstSale: null, months: [] });
    expect(r).toMatchObject({ pct: '150', source: 'MANUAL', warn: true });
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
