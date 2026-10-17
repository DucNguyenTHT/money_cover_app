import { describe, expect, it } from 'vitest';
import {
  householdTaxByMonth,
  householdVatRate,
  pitIncomeRate,
  quarterDeadline,
  spreadRevenue,
  type TaxMonthInput,
} from './household';

const month = (
  m: string,
  food: number,
  profit: number,
  extra: Partial<TaxMonthInput['revenueByGroup']> = {},
) => ({
  month: m,
  revenueByGroup: { PRODUCTION: String(food), ...extra },
  netProfit: String(profit),
});

describe('rates', () => {
  it('food VAT 3%, cut by 20% (2,4%) until 31/12/2026', () => {
    expect(householdVatRate('PRODUCTION', '2026-12-01').toString()).toBe('2.4');
    expect(householdVatRate('PRODUCTION', '2027-01-01').toString()).toBe('3');
    expect(householdVatRate('DISTRIBUTION', '2026-03-01').toString()).toBe('0.8');
  });
  it('PIT on profit by revenue band', () => {
    expect(pitIncomeRate(1_800_000_000)).toBe(15);
    expect(pitIncomeRate(3_000_000_001)).toBe(17);
    expect(pitIncomeRate(60_000_000_000)).toBe(20);
  });
  it('quarter deadlines', () => {
    expect(quarterDeadline(2026, 1)).toBe('2026-04-30');
    expect(quarterDeadline(2026, 4)).toBe('2027-01-31');
  });
});

describe('householdTaxByMonth', () => {
  it('nothing while the year stays at or under 1 tỷ', () => {
    const r = householdTaxByMonth([month('2026-01', 500e6, 50e6), month('2026-02', 500e6, 50e6)], 'INCOME');
    expect(r.map((x) => [x.taxable, x.vat, x.pit])).toEqual([
      [false, '0', '0'],
      [false, '0', '0'],
    ]);
  });

  it('crossing the threshold: VAT on the whole year, the catch-up lands in that month', () => {
    // 600 + 600 = 1,2 tỷ → taxable in February; VAT = 1,2 tỷ × 2,4% = 28,8 tr, all in February.
    const r = householdTaxByMonth([month('2026-01', 600e6, 100e6), month('2026-02', 600e6, 100e6)], 'INCOME');
    expect(r[0]).toMatchObject({ taxable: false, vat: '0', pit: '0' });
    expect(r[1]).toMatchObject({ taxable: true, vat: '28800000', vatYtd: '28800000' });
    // PIT theo lãi: 200 tr × 15% = 30 tr.
    expect(r[1]).toMatchObject({ pit: '30000000', pitYtd: '30000000' });
  });

  it('matches the doc example: 1,8 tỷ / year, PIT theo doanh thu = (1,8 − 1) tỷ × 1,5%', () => {
    const months = Array.from({ length: 12 }, (_, i) =>
      month(`2026-${String(i + 1).padStart(2, '0')}`, 150e6, 25e6),
    );
    const r = householdTaxByMonth(months, 'REVENUE');
    const last = r[11]!;
    expect(last.revenueYtd).toBe('1800000000');
    expect(last.vatYtd).toBe('43200000');
    expect(last.pitYtd).toBe('12000000');
    // Monthly amounts add up to the year.
    expect(r.reduce((s, x) => s + Number(x.vat), 0)).toBe(43_200_000);
    expect(r.reduce((s, x) => s + Number(x.pit), 0)).toBe(12_000_000);
  });

  it('a loss month lowers PIT so far (negative adjustment), never below zero for the year', () => {
    const r = householdTaxByMonth(
      [month('2026-01', 1_100e6, 100e6), month('2026-02', 100e6, -150e6)],
      'INCOME',
    );
    expect(r[0]!.pit).toBe('15000000');
    expect(r[1]).toMatchObject({ pit: '-15000000', pitYtd: '0' });
  });

  it('mixes groups: goods at 1% (0,8%) next to food at 3% (2,4%)', () => {
    const r = householdTaxByMonth([month('2026-05', 1_000e6, 0, { DISTRIBUTION: '500000000' })], 'INCOME');
    expect(r[0]!.vat).toBe(String(1_000e6 * 0.024 + 500e6 * 0.008));
  });
});

describe('spreadRevenue', () => {
  it('splits net revenue (incl. service charge) by item share', () => {
    expect(spreadRevenue(1_100, { PRODUCTION: '750', DISTRIBUTION: '250' })).toEqual({
      DISTRIBUTION: '275',
      PRODUCTION: '825',
    });
    expect(spreadRevenue(500, {})).toEqual({ PRODUCTION: '500' });
  });
});
