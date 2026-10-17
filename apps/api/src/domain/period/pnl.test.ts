import { describe, expect, it } from 'vitest';
import {
  emptyFigures,
  lockProblems,
  monthRange,
  monthStatuses,
  monthsBetween,
  pctOfRevenue,
  pnlLines,
  pnlTotals,
  sumFigures,
  type PnlFigures,
} from './pnl';

const month = (over: Partial<PnlFigures>): PnlFigures => ({ ...emptyFigures(), ...over });
const amount = (f: PnlFigures, key: string) => pnlLines(f).find((l) => l.key === key)!.amount;

describe('monthly P&L', () => {
  const sep = month({
    revenueGross: '100000000',
    discounts: '5000000',
    serviceCharge: '1000000',
    netRevenue: '96000000',
    cogs: '36000000',
    stocktakeLoss: '1500000',
    disposalCancelled: '300000',
    disposalSpoiled: '200000',
    appCommission: '4000000',
    internalUse: '500000',
    overhead: { 'Mặt bằng': '15000000', Lương: '28000000' },
    orders: 1200,
    stockStart: '20000000',
    stockEnd: '22000000',
  });

  it('runs lines 3 → 12 in order', () => {
    expect(amount(sep, 'netRevenue')).toBe('96000000');
    expect(amount(sep, 'grossProfit')).toBe('60000000');
    expect(amount(sep, 'disposal')).toBe('500000');
    expect(amount(sep, 'profitAfterStocktake')).toBe('58000000');
    expect(amount(sep, 'overhead')).toBe('43000000');
    // 58.000.000 − 4.000.000 − 500.000 − 43.000.000
    expect(amount(sep, 'netProfit')).toBe('10500000');
  });

  it('a loss stays negative (never rounded to 0)', () => {
    const bad = month({ ...sep, overhead: { Lương: '70000000' } });
    expect(pnlTotals(bad).netProfit.toNumber()).toBe(-16500000);
  });

  it('quarter = sum of months, line by line; stock from first and last month', () => {
    const oct = month({
      ...sep,
      netRevenue: '4000000',
      revenueGross: '4000000',
      discounts: '0',
      serviceCharge: '0',
      cogs: '1000000',
      overhead: { Điện: '100' },
      orders: 10,
      stockStart: '22000000',
      stockEnd: '23000000',
    });
    const q = sumFigures([sep, oct]);
    expect(q.netRevenue).toBe('100000000');
    expect(q.orders).toBe(1210);
    expect(q.overhead).toEqual({ 'Mặt bằng': '15000000', Lương: '28000000', Điện: '100' });
    expect(q.stockStart).toBe('20000000');
    expect(q.stockEnd).toBe('23000000');
    expect(pnlTotals(q).netProfit.toString()).toBe(
      pnlTotals(sep).netProfit.add(pnlTotals(oct).netProfit).toString(),
    );
  });

  it('VAT-inclusive line only appears when used', () => {
    expect(pnlLines(sep).some((l) => l.key === 'vatInPrice')).toBe(false);
    expect(pnlLines({ ...sep, vatInPrice: '8000' }).some((l) => l.key === 'vatInPrice')).toBe(true);
  });

  it('statuses and lock rules', () => {
    const flags = {
      hasStocktake: false,
      hasOverhead: false,
      pendingLines: 2,
      openOrders: 1,
      unclosedDays: 3,
    };
    expect(monthStatuses(false, flags)).toEqual([
      'PROVISIONAL',
      'NO_STOCKTAKE',
      'MISSING_OVERHEAD',
      'PENDING_STOCK',
    ]);
    expect(monthStatuses(true, flags)).toEqual(['CLOSED']);
    expect(lockProblems({ previousLocked: false, previousHasData: true, flags })).toHaveLength(4);
    expect(
      lockProblems({
        previousLocked: false,
        previousHasData: false,
        flags: { ...flags, pendingLines: 0, openOrders: 0, unclosedDays: 0 },
      }),
    ).toEqual([]);
  });

  it('helpers', () => {
    expect(pctOfRevenue(36000000, 96000000)).toBe('37.5');
    expect(pctOfRevenue(1, 0)).toBeNull();
    expect(monthsBetween('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });
});
