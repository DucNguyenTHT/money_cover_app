// Monthly profit & loss. The month is the unit that is closed; quarters and years are sums of months.
import { D, Decimal, ZERO } from '../money';

/** Raw monthly figures (money as decimal strings so a closed month can be stored as JSON). */
export interface PnlFigures {
  revenueGross: string;
  discounts: string;
  serviceCharge: string;
  /** VAT contained in VAT-inclusive prices; taken out of revenue. */
  vatInPrice: string;
  netRevenue: string;
  cogs: string;
  stocktakeLoss: string;
  disposalCancelled: string;
  disposalSpoiled: string;
  appCommission: string;
  internalUse: string;
  overhead: Record<string, string>;
  /** Memo: VAT collected for the tax office (not revenue). */
  vatCollected: string;
  orders: number;
  guests: number;
  netByChannel: Record<string, string>;
  byMethod: Record<string, string>;
  cashDiff: string;
  purchases: string;
  supplierReturns: string;
  stockStart: string;
  stockEnd: string;
  surplusIn: string;
  /** Net revenue split by the tax group of the dish categories (household tax). Missing in old snapshots. */
  revenueByTaxGroup?: Record<string, string>;
  /** Household tax for the period (tạm tính). Absent for a company (khấu trừ) or in old snapshots. */
  tax?: { vat: string; pit: string };
}

export interface MonthFlags {
  hasStocktake: boolean;
  hasOverhead: boolean;
  pendingLines: number;
  openOrders: number;
  unclosedDays: number;
}

export type PnlLineKey =
  | 'revenueGross'
  | 'discounts'
  | 'serviceCharge'
  | 'vatInPrice'
  | 'netRevenue'
  | 'cogs'
  | 'grossProfit'
  | 'stocktakeLoss'
  | 'disposal'
  | 'disposalCancelled'
  | 'disposalSpoiled'
  | 'profitAfterStocktake'
  | 'appCommission'
  | 'internalUse'
  | 'overhead'
  | 'netProfit'
  | 'taxVat'
  | 'taxPit'
  | 'profitAfterTax'
  | `overhead:${string}`;

export interface PnlLine {
  key: PnlLineKey;
  no: string;
  label: string;
  /** Always the line's own amount; `deduct` lines are subtracted in the totals below them. */
  amount: string;
  deduct: boolean;
  /** Subtotal row (3, 5, 8, 12) — may be negative. */
  total: boolean;
  /** Sub-line shown indented under its parent. */
  child: boolean;
}

const s = (d: Decimal) => d.toString();
const sumRec = (r: Record<string, string>) => Object.values(r).reduce((a, v) => a.add(v), ZERO);

/** Totals derived from the figures (lines 3, 5, 8, 12). */
export function pnlTotals(f: PnlFigures) {
  const netRevenue = D(f.netRevenue);
  const grossProfit = netRevenue.sub(f.cogs);
  const disposal = D(f.disposalCancelled).add(f.disposalSpoiled);
  const profitAfterStocktake = grossProfit.sub(f.stocktakeLoss).sub(disposal);
  const overhead = sumRec(f.overhead);
  const netProfit = profitAfterStocktake.sub(f.appCommission).sub(f.internalUse).sub(overhead);
  const taxVat = D(f.tax?.vat ?? 0);
  const taxPit = D(f.tax?.pit ?? 0);
  const profitAfterTax = netProfit.sub(taxVat).sub(taxPit);
  return {
    netRevenue,
    grossProfit,
    disposal,
    profitAfterStocktake,
    overhead,
    netProfit,
    taxVat,
    taxPit,
    profitAfterTax,
  };
}

/** The report rows, in the order of the plan (1 … 12). */
export function pnlLines(f: PnlFigures): PnlLine[] {
  const t = pnlTotals(f);
  const L = (
    key: PnlLineKey,
    no: string,
    label: string,
    amount: Decimal.Value,
    o: Partial<Pick<PnlLine, 'deduct' | 'total' | 'child'>> = {},
  ): PnlLine => ({
    key,
    no,
    label,
    amount: s(D(amount)),
    deduct: o.deduct ?? false,
    total: o.total ?? false,
    child: o.child ?? false,
  });
  const lines: PnlLine[] = [
    L('revenueGross', '1', 'Doanh thu bán hàng (trước giảm giá)', f.revenueGross),
    L('discounts', '2', 'Giảm giá', f.discounts, { deduct: true }),
    L('serviceCharge', '2b', 'Phụ thu / phí phục vụ', f.serviceCharge),
  ];
  if (!D(f.vatInPrice).isZero())
    lines.push(L('vatInPrice', '2c', 'VAT tách khỏi giá (giá đã gồm VAT)', f.vatInPrice, { deduct: true }));
  lines.push(
    L('netRevenue', '3', 'Doanh thu thuần', t.netRevenue, { total: true }),
    L('cogs', '4', 'Giá vốn hàng bán (định mức, FIFO)', f.cogs, { deduct: true }),
    L('grossProfit', '5', 'Lãi gộp', t.grossProfit, { total: true }),
    L('stocktakeLoss', '6', 'Hao hụt kiểm kê (thiếu − thừa)', f.stocktakeLoss, { deduct: true }),
    L('disposal', '7', 'Xuất huỷ', t.disposal, { deduct: true }),
    L('disposalCancelled', '', 'Món huỷ đã chế biến', f.disposalCancelled, { deduct: true, child: true }),
    L('disposalSpoiled', '', 'Hàng hỏng, huỷ', f.disposalSpoiled, { deduct: true, child: true }),
    L('profitAfterStocktake', '8', 'Lợi nhuận sau kiểm kê', t.profitAfterStocktake, { total: true }),
    L('appCommission', '9', 'Chiết khấu app giao hàng', f.appCommission, { deduct: true }),
    L('internalUse', '10', 'Dùng nội bộ / biếu', f.internalUse, { deduct: true }),
    L('overhead', '11', 'Chi phí chung', t.overhead, { deduct: true }),
    ...Object.entries(f.overhead)
      .sort(([a], [b]) => a.localeCompare(b, 'vi'))
      .map(([cat, v]) => L(`overhead:${cat}`, '', cat, v, { deduct: true, child: true })),
    L('netProfit', '12', f.tax ? 'Lợi nhuận trước thuế' : 'Lợi nhuận ròng', t.netProfit, { total: true }),
  );
  if (f.tax)
    lines.push(
      L('taxVat', '13', 'Thuế GTGT phải nộp (tạm tính)', t.taxVat, { deduct: true }),
      L('taxPit', '14', 'Thuế TNCN phải nộp (tạm tính)', t.taxPit, { deduct: true }),
      L('profitAfterTax', '15', 'Lợi nhuận sau thuế', t.profitAfterTax, { total: true }),
    );
  return lines;
}

const addRec = (a: Record<string, string>, b: Record<string, string>) => {
  const out: Record<string, string> = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = s(D(out[k] ?? 0).add(v));
  return out;
};

const MONEY_KEYS = [
  'revenueGross',
  'discounts',
  'serviceCharge',
  'vatInPrice',
  'netRevenue',
  'cogs',
  'stocktakeLoss',
  'disposalCancelled',
  'disposalSpoiled',
  'appCommission',
  'internalUse',
  'vatCollected',
  'cashDiff',
  'purchases',
  'supplierReturns',
  'surplusIn',
] as const;

export const emptyFigures = (): PnlFigures => ({
  ...(Object.fromEntries(MONEY_KEYS.map((k) => [k, '0'])) as Record<(typeof MONEY_KEYS)[number], string>),
  overhead: {},
  revenueByTaxGroup: {},
  orders: 0,
  guests: 0,
  netByChannel: {},
  byMethod: {},
  stockStart: '0',
  stockEnd: '0',
});

/** Quarter / year / YTD = month by month sum. Stock at start comes from the first month, at end from the last. */
export function sumFigures(months: readonly PnlFigures[]): PnlFigures {
  if (!months.length) return emptyFigures();
  const out = emptyFigures();
  for (const m of months) {
    for (const k of MONEY_KEYS) out[k] = s(D(out[k]).add(m[k]));
    out.overhead = addRec(out.overhead, m.overhead);
    out.revenueByTaxGroup = addRec(out.revenueByTaxGroup ?? {}, m.revenueByTaxGroup ?? {});
    if (m.tax)
      out.tax = {
        vat: s(D(out.tax?.vat ?? 0).add(m.tax.vat)),
        pit: s(D(out.tax?.pit ?? 0).add(m.tax.pit)),
      };
    out.netByChannel = addRec(out.netByChannel, m.netByChannel);
    out.byMethod = addRec(out.byMethod, m.byMethod);
    out.orders += m.orders;
    out.guests += m.guests;
  }
  out.stockStart = months[0]!.stockStart;
  out.stockEnd = months[months.length - 1]!.stockEnd;
  return out;
}

export type MonthStatus = 'CLOSED' | 'PROVISIONAL' | 'NO_STOCKTAKE' | 'MISSING_OVERHEAD' | 'PENDING_STOCK';

/** Badges shown on top of a month so a "good-looking" provisional profit is never mistaken for a final one. */
export function monthStatuses(locked: boolean, flags: MonthFlags): MonthStatus[] {
  if (locked) return ['CLOSED'];
  const out: MonthStatus[] = ['PROVISIONAL'];
  if (!flags.hasStocktake) out.push('NO_STOCKTAKE');
  if (!flags.hasOverhead) out.push('MISSING_OVERHEAD');
  if (flags.pendingLines > 0) out.push('PENDING_STOCK');
  return out;
}

/** Why a month cannot be locked yet (empty = OK). */
export function lockProblems(p: {
  previousLocked: boolean;
  previousHasData: boolean;
  flags: MonthFlags;
}): string[] {
  const out: string[] = [];
  if (!p.previousLocked && p.previousHasData) out.push('Tháng trước chưa khoá sổ');
  if (p.flags.openOrders > 0) out.push(`Còn ${p.flags.openOrders} đơn chưa thanh toán`);
  if (p.flags.pendingLines > 0) out.push(`Còn ${p.flags.pendingLines} dòng nợ kho chưa tất toán`);
  if (p.flags.unclosedDays > 0) out.push(`Còn ${p.flags.unclosedDays} ngày bán hàng chưa chốt ngày`);
  return out;
}

/** Share of net revenue, in percent (null when there is no revenue). */
export const pctOfRevenue = (amount: Decimal.Value, netRevenue: Decimal.Value): string | null =>
  D(netRevenue).isZero() ? null : D(amount).mul(100).div(netRevenue).toDecimalPlaces(1).toString();

/** "2026-10" ± n months. */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to && out.length < 120; m = shiftMonth(m, 1)) out.push(m);
  return out;
}

/** First and last day of a month as YYYY-MM-DD. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}
