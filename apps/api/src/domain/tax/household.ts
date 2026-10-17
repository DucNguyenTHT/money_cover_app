// Household business tax (hộ kinh doanh), from 2026: VAT and PIT as a % of revenue / profit.
// Rules (see docs/thue-gtgt-viet-nam.md):
//  - revenue for the calendar year ≤ 1 tỷ → no VAT, no PIT (Nghị định 68/2026, sửa bởi 141/2026);
//  - above it: VAT = the WHOLE year's revenue × group rate (cut by 20% until 31/12/2026, NĐ 174/2025);
//  - PIT "theo lãi" = profit × 15% (≤ 3 tỷ), 17% (≤ 50 tỷ), 20%; "theo doanh thu" = (revenue − 1 tỷ) × group rate.
// Months are computed cumulatively from January so the monthly amounts always add up to the year's tax:
// the month the threshold is crossed carries the catch-up for the earlier months.
import { D, Decimal, ZERO, allocateVnd, roundVnd } from '../money';
import { TAX_GROUPS, type TaxGroup } from '../enums';

export const HOUSEHOLD_THRESHOLD = 1_000_000_000;

export const TAX_GROUP_INFO: Record<TaxGroup, { label: string; vat: number; pit: number }> = {
  DISTRIBUTION: { label: 'Phân phối, cung cấp hàng hoá', vat: 1, pit: 0.5 },
  SERVICE: { label: 'Dịch vụ, xây dựng không bao thầu nguyên vật liệu', vat: 5, pit: 2 },
  PRODUCTION: { label: 'Sản xuất, vận tải, dịch vụ gắn với hàng hoá (gồm ăn uống)', vat: 3, pit: 1.5 },
  OTHER: { label: 'Hoạt động kinh doanh khác', vat: 2, pit: 1 },
};

/** Temporary cuts of the household VAT rate (in % of the rate). */
export const HOUSEHOLD_VAT_CUTS = [
  {
    from: '2025-07-01',
    to: '2026-12-31',
    cutPct: 20,
    basis: 'Nghị quyết 204/2025/QH15 · Nghị định 174/2025/NĐ-CP',
  },
] as const;

export type PitMethod = 'INCOME' | 'REVENUE';

/** VAT rate (in %) of a group on a date, after any temporary cut. */
export function householdVatRate(group: TaxGroup, date: string): Decimal {
  const base = D(TAX_GROUP_INFO[group].vat);
  const cut = HOUSEHOLD_VAT_CUTS.find((c) => date >= c.from && date <= c.to);
  return cut ? base.mul(100 - cut.cutPct).div(100) : base;
}

/** PIT rate (in %) on profit, by the year's revenue. */
export function pitIncomeRate(yearRevenue: Decimal.Value): number {
  const r = D(yearRevenue);
  if (r.lte(3_000_000_000)) return 15;
  if (r.lte(50_000_000_000)) return 17;
  return 20;
}

export type RevenueByGroup = Partial<Record<TaxGroup, string>>;

/**
 * Spread net revenue (incl. service charge) over tax groups in proportion to item net amounts.
 * No items (or old snapshots) → everything in the food group.
 */
export function spreadRevenue(netRevenue: Decimal.Value, itemsByGroup: RevenueByGroup): RevenueByGroup {
  const groups = TAX_GROUPS.filter((g) => D(itemsByGroup[g] ?? 0).gt(0));
  if (!groups.length) return D(netRevenue).isZero() ? {} : { PRODUCTION: roundVnd(netRevenue).toString() };
  const parts = allocateVnd(
    netRevenue,
    groups.map((g) => itemsByGroup[g]!),
  );
  return Object.fromEntries(groups.map((g, i) => [g, parts[i]!.toString()]));
}

export interface TaxMonthInput {
  /** "YYYY-MM" */
  month: string;
  revenueByGroup: RevenueByGroup;
  /** Profit before tax (P&L "lợi nhuận ròng"). */
  netProfit: string;
}

export interface TaxMonthResult {
  month: string;
  revenue: string;
  revenueYtd: string;
  /** Revenue to date is above the threshold (tax is due for the whole year so far). */
  taxable: boolean;
  vat: string;
  pit: string;
  vatYtd: string;
  pitYtd: string;
}

const groupSum = (r: RevenueByGroup) => TAX_GROUPS.reduce((s, g) => s.add(r[g] ?? 0), ZERO);

/** Months of ONE calendar year, January first, in order (missing months may be skipped). */
export function householdTaxByMonth(months: readonly TaxMonthInput[], method: PitMethod): TaxMonthResult[] {
  let revenueYtd = ZERO;
  let profitYtd = ZERO;
  let vatBase = ZERO; // VAT as if taxable from January
  const byGroupYtd: Record<TaxGroup, Decimal> = {
    DISTRIBUTION: ZERO,
    SERVICE: ZERO,
    PRODUCTION: ZERO,
    OTHER: ZERO,
  };
  let vatPrev = ZERO;
  let pitPrev = ZERO;
  return months.map((m) => {
    const revenue = groupSum(m.revenueByGroup);
    revenueYtd = revenueYtd.add(revenue);
    profitYtd = profitYtd.add(m.netProfit);
    for (const g of TAX_GROUPS) {
      const v = D(m.revenueByGroup[g] ?? 0);
      byGroupYtd[g] = byGroupYtd[g].add(v);
      vatBase = vatBase.add(v.mul(householdVatRate(g, `${m.month}-01`)).div(100));
    }
    const taxable = revenueYtd.gt(HOUSEHOLD_THRESHOLD);
    const vatYtd = taxable ? roundVnd(vatBase) : ZERO;
    let pitYtd = ZERO;
    if (taxable && method === 'INCOME') {
      pitYtd = roundVnd(Decimal.max(profitYtd, 0).mul(pitIncomeRate(revenueYtd)).div(100));
    } else if (taxable) {
      // (revenue − threshold) × the groups' PIT rates, weighted by each group's share of revenue.
      const weighted = TAX_GROUPS.reduce((s, g) => s.add(byGroupYtd[g].mul(TAX_GROUP_INFO[g].pit)), ZERO);
      pitYtd = roundVnd(revenueYtd.sub(HOUSEHOLD_THRESHOLD).mul(weighted).div(revenueYtd).div(100));
    }
    const out: TaxMonthResult = {
      month: m.month,
      revenue: revenue.toString(),
      revenueYtd: revenueYtd.toString(),
      taxable,
      vat: vatYtd.sub(vatPrev).toString(),
      pit: pitYtd.sub(pitPrev).toString(),
      vatYtd: vatYtd.toString(),
      pitYtd: pitYtd.toString(),
    };
    vatPrev = vatYtd;
    pitPrev = pitYtd;
    return out;
  });
}

/** Quarterly return deadline: last day of the month after the quarter ("2026-Q4" → 2027-01-31). */
export function quarterDeadline(year: number, quarter: 1 | 2 | 3 | 4): string {
  const m = quarter * 3 + 1; // month after the quarter
  const y = m > 12 ? year + 1 : year;
  const mm = m > 12 ? 1 : m;
  const last = new Date(Date.UTC(y, mm, 0)).getUTCDate();
  return `${y}-${String(mm).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}
