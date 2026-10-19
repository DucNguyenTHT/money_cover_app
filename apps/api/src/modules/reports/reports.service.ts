import type { Prisma } from '@prisma/client';
import {
  reportByHour,
  reportByStaff,
  reportByTable,
  reportCancelledItems,
  reportCancelledOrders,
  reportChannels,
  reportDaily,
  reportDiscounts,
  reportDishProfit,
  reportDishStocktake,
  reportIssues,
  reportMonthFlags,
  reportOrders,
  reportPayments,
  reportRevenueByTaxGroup,
  reportStock,
  reportStockMovement,
  reportStockValue,
  reportVariance,
} from '@prisma/client/sql';
import { prisma, inTx } from '../../core/db';
import { conflict } from '../../core/errors';
import { writeAudit } from '../../core/audit';
import { defaultBranchId } from '../../core/branch';
import type { AuthUser } from '../../core/auth';
import type {
  CancellationsReport,
  DailyRow,
  Dashboard,
  DishProfitReport,
  MonthPnl,
  PeriodDto,
  RangePnl,
  SalesReport,
  StockMovementReport,
  TaxReport,
} from '../../contracts/reports.contract';
import { fromDbDate, toDbDate } from '../../domain/business-date';
import type { Channel } from '../../domain/enums';
import { D, ZERO, roundVnd, type Decimal } from '../../domain/money';
import {
  lockProblems,
  monthRange,
  monthStatuses,
  monthsBetween,
  pctOfRevenue,
  pnlLines,
  pnlTotals,
  shiftMonth,
  sumFigures,
  type MonthFlags,
  type PnlFigures,
} from '../../domain/period/pnl';
import {
  HOUSEHOLD_THRESHOLD,
  TAX_GROUP_INFO,
  compareMethods,
  householdTaxByMonth,
  householdVatRate,
  pitIncomeRate,
  projectYear,
  quarterDeadline,
  spreadRevenue,
  type RevenueByGroup,
} from '../../domain/tax/household';
import { TAX_GROUPS } from '../../domain/enums';
import { businessToday, getSettings } from '../settings/settings.service';
import { issue as backupIssue } from '../backup/backup.service';
import * as pricing from '../pricing/pricing.service';

type Dec = Prisma.Decimal | null | undefined;
const m = (v: Dec) => (v ? v.toString() : '0');
const n = (v: number | null | undefined) => v ?? 0;
const day = (iso: string) => toDbDate(iso);
const prevDay = (iso: string) => fromDbDate(new Date(Date.parse(`${iso}T00:00:00Z`) - 86400_000));

export const CHANNEL_LABEL: Record<string, string> = {
  DINE_IN: 'Tại bàn',
  TAKEAWAY: 'Mang về',
  APP: 'App giao hàng',
};
export const METHOD_LABEL: Record<string, string> = {
  CASH: 'Tiền mặt',
  TRANSFER: 'Chuyển khoản',
  CARD: 'Thẻ',
  APP: 'App',
};

// ---------------------------------------------------------------- monthly figures

async function computeFigures(
  branchId: number,
  from: string,
  to: string,
): Promise<{ figures: PnlFigures; flags: MonthFlags; activity: number }> {
  const [y, mo] = from.split('-').map(Number) as [number, number];
  const [toY, toM] = to.split('-').map(Number) as [number, number];
  const [orders, channels, payments, issues, stock, startV, endV, overheads, closings, flagsRow, taxGroups] =
    await Promise.all([
      prisma.$queryRawTyped(reportOrders(branchId, day(from), day(to))),
      prisma.$queryRawTyped(reportChannels(branchId, day(from), day(to))),
      prisma.$queryRawTyped(reportPayments(branchId, day(from), day(to))),
      prisma.$queryRawTyped(reportIssues(branchId, day(from), day(to))),
      prisma.$queryRawTyped(reportStock(branchId, day(from), day(to))),
      prisma.$queryRawTyped(reportStockValue(branchId, day(prevDay(from)))),
      prisma.$queryRawTyped(reportStockValue(branchId, day(to))),
      prisma.overheadExpense.groupBy({
        by: ['category'],
        where: {
          branchId,
          OR: monthsBetween(
            `${y}-${String(mo).padStart(2, '0')}`,
            `${toY}-${String(toM).padStart(2, '0')}`,
          ).map((mm) => ({ year: Number(mm.slice(0, 4)), month: Number(mm.slice(5)) })),
        },
        _sum: { amount: true },
      }),
      prisma.dayClosing.aggregate({
        where: { branchId, businessDate: { gte: day(from), lte: day(to) } },
        _sum: { diff: true },
      }),
      prisma.$queryRawTyped(reportMonthFlags(branchId, day(from), day(to))),
      prisma.$queryRawTyped(reportRevenueByTaxGroup(branchId, day(from), day(to))),
    ]);
  const o = orders[0]!;
  const st = stock[0]!;
  const f = flagsRow[0]!;
  const issue = (reason: string, fromOrder?: boolean) =>
    issues
      .filter((i) => i.reason === reason && (fromOrder === undefined || i.from_order === fromOrder))
      .reduce((s, i) => s.add(m(i.cost)), ZERO)
      .toString();
  const figures: PnlFigures = {
    revenueGross: m(o.revenue_gross),
    discounts: m(o.discounts),
    serviceCharge: m(o.service_charge),
    vatInPrice: m(o.vat_in_price),
    netRevenue: m(o.net_revenue),
    cogs: issue('SALE_USE'),
    stocktakeLoss: m(st.stocktake_loss),
    disposalCancelled: issue('DISPOSAL', true),
    disposalSpoiled: issue('DISPOSAL', false),
    appCommission: m(o.app_commission),
    internalUse: issue('INTERNAL_USE'),
    overhead: Object.fromEntries(overheads.map((r) => [r.category, m(r._sum.amount)])),
    vatCollected: m(o.vat_collected),
    orders: n(o.orders),
    guests: n(o.guests),
    netByChannel: Object.fromEntries(channels.map((c) => [c.channel ?? '', m(c.net_revenue)])),
    byMethod: Object.fromEntries(payments.map((p) => [p.method ?? '', m(p.amount)])),
    cashDiff: m(closings._sum.diff),
    purchases: m(st.purchases),
    supplierReturns: issue('SUPPLIER_RETURN'),
    stockStart: m(startV[0]?.value),
    stockEnd: m(endV[0]?.value),
    surplusIn: m(st.surplus_in),
    revenueByTaxGroup: spreadRevenue(
      m(o.net_revenue),
      Object.fromEntries(taxGroups.map((g) => [g.tax_group ?? 'PRODUCTION', m(g.net_amount)])),
    ) as Record<string, string>,
  };
  const flags: MonthFlags = {
    hasStocktake: n(f.stocktakes) > 0,
    hasOverhead: n(f.overhead_rows) > 0,
    pendingLines: n(f.pending_lines),
    openOrders: n(f.open_orders),
    unclosedDays: n(f.unclosed_days),
  };
  return { figures, flags, activity: n(f.activity) };
}

async function lockOf(branchId: number, month: string) {
  const [y, mo] = month.split('-').map(Number) as [number, number];
  return prisma.periodLock.findUnique({ where: { branchId_year_month: { branchId, year: y, month: mo } } });
}

/** A month's figures: the stored snapshot when the month is closed, computed live otherwise. */
async function monthFigures(branchId: number, month: string) {
  const [y, mo] = month.split('-').map(Number) as [number, number];
  const snap = await prisma.monthlyClosing.findUnique({
    where: { branchId_year_month: { branchId, year: y, month: mo } },
  });
  if (snap) {
    const stored = snap.figures as unknown as { figures: PnlFigures; flags: MonthFlags };
    return { figures: stored.figures, flags: stored.flags, locked: true, activity: 1 };
  }
  const { from, to } = monthRange(month);
  return { ...(await computeFigures(branchId, from, to)), locked: false };
}

// ---------------------------------------------------------------- household tax (tạm tính)

type MonthData = Awaited<ReturnType<typeof monthFigures>>;

const revenueGroups = (f: PnlFigures): RevenueByGroup =>
  f.revenueByTaxGroup ?? spreadRevenue(f.netRevenue, {});

/**
 * January … `lastMonth` of one year with the household tax attached (cumulative from January, so the months add
 * up to the year). A month closed with a stored tax keeps it; open months take "year-to-date − already counted".
 * Company regime (khấu trừ): figures returned unchanged.
 */
async function yearWithTax(branchId: number, lastMonth: string): Promise<Map<string, MonthData>> {
  const months = monthsBetween(`${lastMonth.slice(0, 4)}-01`, lastMonth);
  const [data, settings] = await Promise.all([
    Promise.all(months.map((mm) => monthFigures(branchId, mm))),
    getSettings(),
  ]);
  if (settings.tax_regime !== 'HOUSEHOLD') return new Map(months.map((mm, i) => [mm, data[i]!]));
  const calc = householdTaxByMonth(
    months.map((mm, i) => ({
      month: mm,
      revenueByGroup: revenueGroups(data[i]!.figures),
      netProfit: pnlTotals(data[i]!.figures).netProfit.toString(),
    })),
    settings.household_pit_method,
  );
  let vatSoFar = ZERO;
  let pitSoFar = ZERO;
  return new Map(
    months.map((mm, i) => {
      const d = data[i]!;
      const c = calc[i]!;
      const tax =
        d.locked && d.figures.tax
          ? d.figures.tax
          : { vat: D(c.vatYtd).sub(vatSoFar).toString(), pit: D(c.pitYtd).sub(pitSoFar).toString() };
      vatSoFar = vatSoFar.add(tax.vat);
      pitSoFar = pitSoFar.add(tax.pit);
      return [mm, { ...d, figures: { ...d.figures, tax } }];
    }),
  );
}

/** Several months (any years) with tax attached; each year is computed once. */
async function monthsWithTax(branchId: number, months: readonly string[]): Promise<Map<string, MonthData>> {
  const lastByYear = new Map<string, string>();
  for (const mm of months) {
    const y = mm.slice(0, 4);
    if (!lastByYear.has(y) || lastByYear.get(y)! < mm) lastByYear.set(y, mm);
  }
  const maps = await Promise.all([...lastByYear.values()].map((last) => yearWithTax(branchId, last)));
  return new Map(maps.flatMap((mp) => [...mp]));
}

/** "Thuế phải nộp" for a calendar year (up to the current month for this year). */
export async function taxReport(year: number): Promise<TaxReport> {
  const branchId = await defaultBranchId();
  const [today, settings] = await Promise.all([businessToday(), getSettings()]);
  const thisYear = Number(today.slice(0, 4));
  const household = settings.tax_regime === 'HOUSEHOLD';
  const lastMonth = year < thisYear ? `${year}-12` : year === thisYear ? today.slice(0, 7) : null;
  const data = lastMonth ? await yearWithTax(branchId, lastMonth) : new Map<string, MonthData>();

  let revenueYtd = ZERO;
  let crossedMonth: string | null = null;
  const yearGroups: Record<string, Decimal> = {};
  const months = [...data].map(([month, d]) => {
    const groups = revenueGroups(d.figures);
    for (const g of TAX_GROUPS) yearGroups[g] = (yearGroups[g] ?? ZERO).add(groups[g] ?? 0);
    const revenue = TAX_GROUPS.reduce((s, g) => s.add(groups[g] ?? 0), ZERO);
    revenueYtd = revenueYtd.add(revenue);
    if (!crossedMonth && revenueYtd.gt(HOUSEHOLD_THRESHOLD)) crossedMonth = month;
    return {
      month,
      locked: d.locked,
      revenue: revenue.toString(),
      revenueYtd: revenueYtd.toString(),
      profit: pnlTotals(d.figures).netProfit.toString(),
      // Company (khấu trừ): only output VAT is known here; input VAT comes in a later phase.
      vat: household ? (d.figures.tax?.vat ?? '0') : d.figures.vatCollected,
      pit: household ? (d.figures.tax?.pit ?? '0') : '0',
    };
  });
  const sumOf = (rows: typeof months, k: 'revenue' | 'profit' | 'vat' | 'pit') =>
    rows.reduce((s, r) => s.add(r[k]), ZERO).toString();
  const quarters = ([1, 2, 3, 4] as const)
    .map((q) => ({ q, rows: months.filter((r) => Math.ceil(Number(r.month.slice(5)) / 3) === q) }))
    .filter((x) => x.rows.length)
    .map(({ q, rows }) => ({
      quarter: q,
      revenue: sumOf(rows, 'revenue'),
      vat: sumOf(rows, 'vat'),
      pit: sumOf(rows, 'pit'),
      deadline: quarterDeadline(year, q),
    }));
  const rateDate = year === thisYear ? today : `${year}-12-31`;
  return {
    year,
    regime: settings.tax_regime,
    pitMethod: settings.household_pit_method,
    einvoiceRegistered: settings.einvoice_registered,
    threshold: String(HOUSEHOLD_THRESHOLD),
    crossedMonth,
    months,
    quarters,
    total: {
      revenue: sumOf(months, 'revenue'),
      profit: sumOf(months, 'profit'),
      vat: sumOf(months, 'vat'),
      pit: sumOf(months, 'pit'),
    },
    groups: TAX_GROUPS.filter((g) => yearGroups[g]?.gt(0) || g === 'PRODUCTION').map((g) => ({
      group: g,
      label: TAX_GROUP_INFO[g].label,
      revenue: (yearGroups[g] ?? ZERO).toString(),
      vatRate: householdVatRate(g, rateDate).toString(),
      pitRate: String(TAX_GROUP_INFO[g].pit),
    })),
    pitIncomeRate: pitIncomeRate(revenueYtd),
    comparison: household ? comparisonOf([...data], year, year === thisYear) : null,
  };
}

/** Both PIT methods on this year's months; for the current year also projected to 12 months. */
function comparisonOf(entries: [string, MonthData][], year: number, current: boolean) {
  const inputs = entries.map(([month, d]) => ({
    month,
    revenueByGroup: revenueGroups(d.figures),
    netProfit: pnlTotals(d.figures).netProfit.toString(),
  }));
  const projection = current ? projectYear(inputs, year) : [];
  const basisMonths = inputs.filter(
    (m) => !D(m.netProfit).isZero() || Object.values(m.revenueByGroup).some((v) => D(v ?? 0).gt(0)),
  ).length;
  return {
    actual: compareMethods(inputs),
    projected: projection.length && basisMonths < 12 ? { ...compareMethods(projection), basisMonths } : null,
  };
}

export async function pnlMonth(month: string): Promise<MonthPnl> {
  const branchId = await defaultBranchId();
  const year = month.slice(0, 4);
  const ytdMonths = monthsBetween(`${year}-01`, month);
  const prevMonth = shiftMonth(month, -1);
  const withTax = await monthsWithTax(branchId, [...ytdMonths, prevMonth]);
  const cur = withTax.get(month)!;
  const prev = withTax.get(prevMonth)!;
  const ytdParts = ytdMonths.filter((x) => x !== month).map((x) => withTax.get(x)!);
  const ytd = sumFigures([...ytdParts.map((p) => p.figures), cur.figures]);
  const f = cur.figures;
  const curLines = pnlLines(f);
  const prevMap = new Map(pnlLines(prev.figures).map((l) => [l.key, l.amount]));
  const ytdMap = new Map(pnlLines(ytd).map((l) => [l.key, l.amount]));
  const totals = pnlTotals(f);
  const issuedOut = D(f.cogs)
    .add(f.disposalCancelled)
    .add(f.disposalSpoiled)
    .add(f.internalUse)
    .add(f.supplierReturns);
  // Shortages are part of stocktakeLoss together with (negative) surplus value.
  const shortageValue = D(f.stocktakeLoss).add(f.surplusIn);
  const gap = D(f.stockStart)
    .add(f.purchases)
    .add(f.surplusIn)
    .sub(issuedOut)
    .sub(shortageValue)
    .sub(f.stockEnd);
  return {
    month,
    locked: cur.locked,
    statuses: monthStatuses(cur.locked, cur.flags),
    flags: cur.flags,
    lines: curLines.map((l) => {
      const previous = prevMap.get(l.key) ?? '0';
      return {
        ...l,
        pct: pctOfRevenue(l.amount, totals.netRevenue),
        previous,
        diff: D(l.amount).sub(previous).toString(),
        ytd: ytdMap.get(l.key) ?? '0',
      };
    }),
    kpis: {
      orders: f.orders,
      guests: f.guests,
      avgPerOrder: f.orders ? roundVnd(D(f.netRevenue).div(f.orders)).toString() : '0',
      foodCostPct: pctOfRevenue(f.cogs, f.netRevenue),
      vatCollected: f.vatCollected,
      netByChannel: f.netByChannel,
      byMethod: f.byMethod,
      cashDiff: f.cashDiff,
      purchases: f.purchases,
      supplierReturns: f.supplierReturns,
      stockStart: f.stockStart,
      stockEnd: f.stockEnd,
      stockBalanceGap: roundVnd(gap).toString(),
    },
  };
}

export async function pnlRange(from: string, to: string): Promise<RangePnl> {
  const branchId = await defaultBranchId();
  const months = monthsBetween(from, to).slice(0, 24);
  const withTax = await monthsWithTax(branchId, months);
  const data = months.map((mm) => withTax.get(mm)!);
  const all = sumFigures(data.map((d) => d.figures));
  const perMonth = data.map((d) => new Map(pnlLines(d.figures).map((l) => [l.key, l.amount])));
  // Rows = the union of lines (overhead categories may differ month to month), in the order of the total column.
  const rows = pnlLines(all).map((l) => ({
    key: l.key,
    no: l.no,
    label: l.label,
    deduct: l.deduct,
    total: l.total,
    child: l.child,
    amounts: perMonth.map((pm) => pm.get(l.key) ?? '0'),
    sum: l.amount,
  }));
  return {
    months: months.map((mm, i) => ({ month: mm, statuses: monthStatuses(data[i]!.locked, data[i]!.flags) })),
    rows,
    netRevenue: data.map((d) => pnlTotals(d.figures).netRevenue.toString()),
    netProfit: data.map((d) => pnlTotals(d.figures).netProfit.toString()),
    profitAfterTax: data.some((d) => d.figures.tax)
      ? data.map((d) => pnlTotals(d.figures).profitAfterTax.toString())
      : null,
  };
}

// ---------------------------------------------------------------- daily & sales

export async function daily(from: string, to: string): Promise<DailyRow[]> {
  const branchId = await defaultBranchId();
  const [rows, closings] = await Promise.all([
    prisma.$queryRawTyped(reportDaily(branchId, day(from), day(to))),
    prisma.dayClosing.findMany({ where: { branchId, businessDate: { gte: day(from), lte: day(to) } } }),
  ]);
  const byDay = new Map(closings.map((c) => [fromDbDate(c.businessDate), c]));
  return rows.map((r) => {
    const d = fromDbDate(r.day);
    const c = byDay.get(d);
    return {
      day: d,
      orders: n(r.orders),
      guests: n(r.guests),
      netRevenue: m(r.net_revenue),
      cost: m(r.cost_total),
      grossProfit: D(m(r.net_revenue)).sub(m(r.cost_total)).toString(),
      discounts: m(r.discounts),
      vat: m(r.vat),
      appCommission: m(r.app_commission),
      cancelled: n(r.cancelled),
      belowCost: n(r.below_cost),
      cashDiff: c ? c.diff.toString() : null,
      closed: !!c && !c.needsReclose,
    };
  });
}

export async function sales(from: string, to: string): Promise<SalesReport> {
  const branchId = await defaultBranchId();
  const args = [branchId, day(from), day(to)] as const;
  const [hours, channels, methods, tables, staff, dishes, options] = await Promise.all([
    prisma.$queryRawTyped(reportByHour(...args)),
    prisma.$queryRawTyped(reportChannels(...args)),
    prisma.$queryRawTyped(reportPayments(...args)),
    prisma.$queryRawTyped(reportByTable(...args)),
    prisma.$queryRawTyped(reportByStaff(...args)),
    prisma.$queryRawTyped(reportDishProfit(...args, null)),
    // Grouped by name as sold (the option may since have been renamed or removed).
    prisma.$queryRaw<{ group_name: string; name: string; qty: bigint; amount: Prisma.Decimal }[]>`
      SELECT op.group_name, op.name, SUM(oi.qty) AS qty, SUM(oi.qty * op.price) AS amount
      FROM order_item_options op
      JOIN order_items oi ON oi.id = op.order_item_id
      JOIN orders o ON o.id = oi.order_id
      WHERE o.branch_id = ${branchId} AND o.status = 'PAID' AND oi.status = 'ACTIVE'
        AND o.business_date BETWEEN ${day(from)}::date AND ${day(to)}::date
      GROUP BY op.group_name, op.name
      ORDER BY SUM(oi.qty) DESC
      LIMIT 30`,
  ]);
  return {
    topOptions: options.map((x) => ({
      groupName: x.group_name,
      name: x.name,
      qty: Number(x.qty),
      amount: x.amount.toString(),
    })),
    byHour: hours.map((h) => ({ hour: n(h.hour), orders: n(h.orders), netRevenue: m(h.net_revenue) })),
    byChannel: channels.map((c) => ({
      key: c.channel ?? '',
      label: CHANNEL_LABEL[c.channel ?? ''] ?? '',
      orders: n(c.orders),
      netRevenue: m(c.net_revenue),
    })),
    byMethod: methods.map((p) => ({
      key: p.method ?? '',
      label: METHOD_LABEL[p.method ?? ''] ?? '',
      payments: n(p.payments),
      amount: m(p.amount),
    })),
    byTable: tables.map((t) => ({
      key: `${t.channel}:${t.area}:${t.table_name}`,
      label: t.channel === 'DINE_IN' ? `${t.area} · ${t.table_name}` : (CHANNEL_LABEL[t.channel ?? ''] ?? ''),
      orders: n(t.orders),
      netRevenue: m(t.net_revenue),
    })),
    byStaff: staff.map((s) => ({
      key: String(s.user_id),
      label: s.full_name,
      orders: n(s.orders),
      netRevenue: m(s.net_revenue),
      discounts: m(s.discounts),
    })),
    topDishes: [...dishes]
      .sort((a, b) => n(b.qty) - n(a.qty))
      .slice(0, 15)
      .map((d) => ({ dishId: d.dish_id, name: d.name, qty: n(d.qty), netRevenue: m(d.net_revenue) })),
  };
}

// ---------------------------------------------------------------- dish profit

async function overheadFor(branchId: number, from: string, to: string) {
  const months = monthsBetween(from.slice(0, 7), to.slice(0, 7));
  const r = await prisma.overheadExpense.aggregate({
    where: {
      branchId,
      OR: months.map((mm) => ({ year: Number(mm.slice(0, 4)), month: Number(mm.slice(5)) })),
    },
    _sum: { amount: true },
  });
  return D(m(r._sum.amount));
}

export async function dishProfit(from: string, to: string, channel?: Channel): Promise<DishProfitReport> {
  const branchId = await defaultBranchId();
  const [rows, allocs, all, overhead] = await Promise.all([
    prisma.$queryRawTyped(reportDishProfit(branchId, day(from), day(to), channel ?? null)),
    prisma.$queryRawTyped(reportDishStocktake(branchId, day(from), day(to))),
    computeFigures(branchId, from, to),
    overheadFor(branchId, from, to),
  ]);
  const totalNet = D(all.figures.netRevenue);
  const rate = totalNet.gt(0) ? overhead.div(totalNet) : null;
  const withStocktake = !channel;
  const allocBy = new Map(allocs.map((a) => [a.dish_id, D(m(a.value))]));
  const out = rows.map((r) => {
    const net = D(m(r.net_revenue));
    const cost = D(m(r.cost));
    const gross = net.sub(cost);
    const stocktake = withStocktake ? (allocBy.get(r.dish_id) ?? ZERO) : ZERO;
    const after = gross.sub(stocktake);
    const commission = roundVnd(m(r.app_commission));
    const oh = rate ? roundVnd(net.mul(rate)) : ZERO;
    const netProfit = after.sub(commission).sub(oh);
    const qty = n(r.qty);
    return {
      dishId: r.dish_id,
      name: r.name,
      category: r.category,
      qty,
      netRevenue: net.toString(),
      cost: cost.toString(),
      grossProfit: gross.toString(),
      foodCostPct: pctOfRevenue(cost, net),
      stocktake: stocktake.toString(),
      afterStocktake: after.toString(),
      appCommission: commission.toString(),
      overhead: oh.toString(),
      netProfit: netProfit.toString(),
      perPortion: qty ? roundVnd(netProfit.div(qty)).toString() : '0',
    };
  });
  let reconciliation: DishProfitReport['reconciliation'] = null;
  if (withStocktake) {
    const f = all.figures;
    const dishesAfter = out.reduce((s, r) => s.add(r.afterStocktake), ZERO);
    const generalLoss = D(m(allocs.find((a) => a.dish_id === null)?.value));
    const disposal = D(f.disposalCancelled).add(f.disposalSpoiled);
    const result = dishesAfter
      .add(f.serviceCharge)
      .sub(generalLoss)
      .sub(disposal)
      .sub(f.appCommission)
      .sub(f.internalUse)
      .sub(overhead);
    reconciliation = {
      dishesAfterStocktake: dishesAfter.toString(),
      serviceCharge: f.serviceCharge,
      generalLoss: generalLoss.toString(),
      disposal: disposal.toString(),
      appCommission: f.appCommission,
      internalUse: f.internalUse,
      overhead: overhead.toString(),
      result: result.toString(),
      pnlNetProfit: pnlTotals({ ...f, overhead: { all: overhead.toString() } }).netProfit.toString(),
    };
  }
  return {
    overheadRate: rate ? rate.mul(100).toDecimalPlaces(2).toString() : null,
    stocktakeIncluded: withStocktake,
    rows: out,
    reconciliation,
  };
}

// ---------------------------------------------------------------- control reports

export async function cancellations(from: string, to: string): Promise<CancellationsReport> {
  const branchId = await defaultBranchId();
  const args = [branchId, day(from), day(to)] as const;
  const [orders, items, discounts] = await Promise.all([
    prisma.$queryRawTyped(reportCancelledOrders(...args)),
    prisma.$queryRawTyped(reportCancelledItems(...args)),
    prisma.$queryRawTyped(reportDiscounts(...args)),
  ]);
  return {
    orders: orders.map((o) => ({
      id: o.id,
      code: o.code,
      day: fromDbDate(o.day),
      channel: o.channel ?? '',
      total: m(o.total),
      reason: o.cancel_reason,
      cancelledAt: o.cancelled_at?.toISOString() ?? null,
      wasPaid: !!o.was_paid,
      cancelledBy: o.cancelled_by,
      approvedBy: o.approved_by,
    })),
    items: items.map((i) => ({
      id: i.id,
      code: i.code,
      day: fromDbDate(i.day),
      dish: i.dish,
      qty: i.qty,
      amount: m(i.amount),
      reason: i.cancel_reason,
      wasted: i.wasted,
      cancelledAt: i.cancelled_at?.toISOString() ?? null,
      cancelledBy: i.cancelled_by,
    })),
    discounts: discounts.map((d) => ({
      id: d.id,
      code: d.code,
      day: fromDbDate(d.day),
      subtotal: m(d.subtotal),
      discount: m(d.discount),
      reason: d.discount_reason,
      netRevenue: m(d.net_revenue),
      cost: m(d.cost_total),
      profit: D(m(d.net_revenue)).sub(m(d.cost_total)).toString(),
      paidBy: d.paid_by,
      approvedBy: d.approved_by,
    })),
  };
}

export async function stockMovement(from: string, to: string): Promise<StockMovementReport> {
  const branchId = await defaultBranchId();
  const rows = await prisma.$queryRawTyped(reportStockMovement(branchId, day(from), day(to)));
  const mv = (q: Dec, v: Dec) => ({
    qty: D(m(q)).toDecimalPlaces(4).toString(),
    value: roundVnd(m(v)).toString(),
  });
  return {
    rows: rows
      .map((r) => {
        const closeQ = D(m(r.open_q))
          .add(m(r.in_q))
          .add(m(r.surplus_q))
          .sub(m(r.sale_q))
          .sub(m(r.disposal_q))
          .sub(m(r.return_q))
          .sub(m(r.internal_q))
          .sub(m(r.short_q));
        const closeV = D(m(r.open_v))
          .add(m(r.in_v))
          .add(m(r.surplus_v))
          .sub(m(r.sale_v))
          .sub(m(r.disposal_v))
          .sub(m(r.return_v))
          .sub(m(r.internal_v))
          .sub(m(r.short_v));
        return {
          ingredientId: r.ingredient_id,
          code: r.code,
          name: r.name,
          unit: r.unit,
          opening: mv(r.open_q, r.open_v),
          purchased: mv(r.in_q, r.in_v),
          surplus: mv(r.surplus_q, r.surplus_v),
          sold: mv(r.sale_q, r.sale_v),
          disposed: mv(r.disposal_q, r.disposal_v),
          returned: mv(r.return_q, r.return_v),
          internal: mv(r.internal_q, r.internal_v),
          shortage: mv(r.short_q, r.short_v),
          closing: { qty: closeQ.toDecimalPlaces(4).toString(), value: roundVnd(closeV).toString() },
        };
      })
      .filter((r) =>
        [
          r.opening,
          r.purchased,
          r.surplus,
          r.sold,
          r.disposed,
          r.returned,
          r.internal,
          r.shortage,
          r.closing,
        ].some((x) => Number(x.qty) !== 0 || Number(x.value) !== 0),
      ),
  };
}

export async function variance(from: string, to: string) {
  const branchId = await defaultBranchId();
  const rows = await prisma.$queryRawTyped(reportVariance(branchId, day(from), day(to)));
  return rows.map((r) => ({
    stocktakeId: r.stocktake_id,
    day: fromDbDate(r.day),
    code: r.code,
    name: r.name,
    unit: r.unit,
    bookQty: m(r.book_qty),
    actualQty: m(r.actual_qty),
    diffQty: m(r.diff_qty),
    lossValue: m(r.loss_value),
  }));
}

// ---------------------------------------------------------------- dashboard

export async function dashboard(): Promise<Dashboard> {
  const branchId = await defaultBranchId();
  const today = await businessToday();
  const month = today.slice(0, 7);
  const from30 = fromDbDate(new Date(Date.parse(`${today}T00:00:00Z`) - 29 * 86400_000));
  const [branch, staffCount, dishCount, recipeCount, receiptCount, printerCount, pinCount] =
    await Promise.all([
      prisma.branch.findUniqueOrThrow({ where: { id: branchId } }),
      prisma.user.count({ where: { role: { not: 'ADMIN' }, active: true } }),
      prisma.dish.count({ where: { active: true } }),
      prisma.dishRecipe.count(),
      prisma.receipt.count({ where: { branchId } }),
      prisma.printer.count({ where: { active: true } }),
      prisma.user.count({ where: { role: 'ADMIN', active: true, pinHash: { not: null } } }),
    ]);
  const [
    days,
    hours,
    monthData,
    dishes,
    openOrders,
    tables,
    priceAlerts,
    pending,
    lockedPins,
    settings,
    backup,
    ytdSales,
  ] = await Promise.all([
    daily(from30, today),
    prisma.$queryRawTyped(reportByHour(branchId, day(today), day(today))),
    monthsWithTax(branchId, [month]).then((mp) => mp.get(month)!),
    prisma.$queryRawTyped(reportDishProfit(branchId, day(`${month}-01`), day(today), null)),
    prisma.order.findMany({
      where: { branchId, status: 'OPEN' },
      select: { tableId: true, businessDate: true },
    }),
    prisma.diningTable.count({ where: { active: true } }),
    pricing.alerts(),
    prisma.issueItem.groupBy({
      by: ['ingredientId'],
      where: { pendingQty: { gt: 0 }, issue: { branchId } },
    }),
    prisma.user.count({ where: { pinLockedUntil: { gt: new Date() } } }),
    getSettings(),
    backupIssue(),
    prisma.order.aggregate({
      where: {
        branchId,
        status: 'PAID',
        businessDate: { gte: day(`${today.slice(0, 4)}-01-01`), lte: day(today) },
      },
      _sum: { netRevenue: true },
    }),
  ]);
  const t = days.find((d) => d.day === today);
  const y = days.find((d) => d.day === prevDay(today));
  const totals = pnlTotals(monthData.figures);
  // Fill missing days so the 30-day line has no gaps.
  const last30 = Array.from({ length: 30 }, (_, i) => {
    const d = fromDbDate(new Date(Date.parse(`${from30}T00:00:00Z`) + i * 86400_000));
    const r = days.find((x) => x.day === d);
    return { day: d, netRevenue: r?.netRevenue ?? '0', grossProfit: r?.grossProfit ?? '0' };
  });
  return {
    today,
    todayOrders: t?.orders ?? 0,
    todayGuests: t?.guests ?? 0,
    todayNetRevenue: t?.netRevenue ?? '0',
    todayGrossProfit: t?.grossProfit ?? '0',
    yesterdayNetRevenue: y?.netRevenue ?? '0',
    openOrders: openOrders.length,
    tablesInUse: new Set(openOrders.map((o) => o.tableId).filter((x) => x !== null)).size,
    tablesTotal: tables,
    month,
    monthStatuses: monthStatuses(monthData.locked, monthData.flags),
    monthNetRevenue: totals.netRevenue.toString(),
    monthGrossProfit: totals.grossProfit.toString(),
    monthNetProfit: totals.netProfit.toString(),
    monthProfitAfterTax: monthData.figures.tax ? totals.profitAfterTax.toString() : null,
    last30,
    byHourToday: hours.map((h) => ({ hour: n(h.hour), netRevenue: m(h.net_revenue) })),
    topDishes: [...dishes]
      .sort((a, b) => n(b.qty) - n(a.qty))
      .slice(0, 5)
      .map((d) => ({ name: d.name, qty: n(d.qty), netRevenue: m(d.net_revenue) })),
    setup: {
      // The seed names the shop "[TÊN QUÁN]" until the owner sets it.
      shopNamed: !branch.name.includes('['),
      staffAccounts: staffCount > 0,
      dishes: dishCount > 0,
      recipes: recipeCount > 0,
      openingStock: receiptCount > 0,
      printers: printerCount > 0,
      pinSet: pinCount > 0,
    },
    alerts: {
      pendingIngredients: pending.length,
      priceAlerts: priceAlerts.length,
      lossDishes: priceAlerts.filter((a) => a.alert === 'LOSS').length,
      cancelledToday: t?.cancelled ?? 0,
      belowCostToday: t?.belowCost ?? 0,
      unclosedDays: monthData.flags.unclosedDays,
      backup,
      staleOpenOrders: openOrders.filter((o) => fromDbDate(o.businessDate) < today).length,
      lockedPins,
    },
    tax:
      settings.tax_regime === 'HOUSEHOLD'
        ? {
            revenueYtd: m(ytdSales._sum.netRevenue),
            threshold: String(HOUSEHOLD_THRESHOLD),
            einvoiceRegistered: settings.einvoice_registered,
          }
        : null,
  };
}

// ---------------------------------------------------------------- periods

/** `withTax` (optional) = months already computed with tax, so a whole year is computed once. */
async function periodDto(
  branchId: number,
  month: string,
  withTax?: Map<string, MonthData>,
): Promise<PeriodDto> {
  const [data, lock] = await Promise.all([
    withTax?.get(month) ?? monthsWithTax(branchId, [month]).then((mp) => mp.get(month)!),
    lockOf(branchId, month),
  ]);
  const t = pnlTotals(data.figures);
  let problems: string[] = [];
  if (!data.locked) {
    const prevMonth = shiftMonth(month, -1);
    const [prevLock, prevData] = await Promise.all([
      lockOf(branchId, prevMonth),
      computeFigures(branchId, monthRange(prevMonth).from, monthRange(prevMonth).to),
    ]);
    problems = lockProblems({
      previousLocked: !!prevLock,
      previousHasData: prevData.activity > 0,
      flags: data.flags,
    });
  }
  const who = lock
    ? await prisma.user.findUnique({ where: { id: lock.lockedById }, select: { fullName: true } })
    : null;
  return {
    month,
    statuses: monthStatuses(data.locked, data.flags),
    locked: !!lock,
    lockedAt: lock?.lockedAt.toISOString() ?? null,
    lockedByName: who?.fullName ?? null,
    netRevenue: t.netRevenue.toString(),
    netProfit: t.netProfit.toString(),
    profitAfterTax: data.figures.tax ? t.profitAfterTax.toString() : null,
    problems,
    hasActivity: data.locked || data.activity > 0,
  };
}

export async function periods(year: number) {
  const branchId = await defaultBranchId();
  const months = monthsBetween(`${year}-01`, `${year}-12`);
  const withTax = await yearWithTax(branchId, months[11]!);
  return Promise.all(months.map((mm) => periodDto(branchId, mm, withTax)));
}

export async function lock(user: AuthUser, month: string) {
  const branchId = await defaultBranchId();
  const p = await periodDto(branchId, month);
  if (p.locked) throw conflict('ALREADY_LOCKED', `Tháng ${month} đã khoá sổ`);
  if (p.problems.length)
    throw conflict('CANNOT_LOCK', `Chưa khoá sổ được: ${p.problems.join('; ')}`, { problems: p.problems });
  const { from, to } = monthRange(month);
  // Snapshot includes the household tax of the month, so a closed month's tax never changes afterwards.
  const [withTax, dishes] = await Promise.all([monthsWithTax(branchId, [month]), dishProfit(from, to)]);
  const live = withTax.get(month)!;
  const [y, mo] = month.split('-').map(Number) as [number, number];
  await inTx(async (tx) => {
    await tx.periodLock.create({ data: { branchId, year: y, month: mo, lockedById: user.id } });
    await tx.monthlyClosing.create({
      data: {
        branchId,
        year: y,
        month: mo,
        figures: JSON.parse(JSON.stringify({ figures: live.figures, flags: live.flags })),
        dishProfit: JSON.parse(JSON.stringify(dishes)),
      },
    });
    await writeAudit(tx, {
      entity: 'period',
      entityId: month,
      action: 'LOCK',
      after: { netProfit: pnlTotals(live.figures).netProfit.toString() },
      userId: user.id,
    });
  });
  return periodDto(branchId, month);
}

export async function unlock(user: AuthUser, month: string, reason: string) {
  const branchId = await defaultBranchId();
  const lockRow = await lockOf(branchId, month);
  if (!lockRow) throw conflict('NOT_LOCKED', `Tháng ${month} chưa khoá sổ`);
  const later = await prisma.periodLock.findFirst({
    where: {
      branchId,
      OR: [{ year: { gt: lockRow.year } }, { year: lockRow.year, month: { gt: lockRow.month } }],
    },
  });
  if (later)
    throw conflict('NOT_LATEST', 'Chỉ mở khoá được tháng khoá gần nhất — mở khoá các tháng sau trước');
  await inTx(async (tx) => {
    const snap = await tx.monthlyClosing.findUnique({
      where: { branchId_year_month: { branchId, year: lockRow.year, month: lockRow.month } },
    });
    await tx.monthlyClosing.deleteMany({ where: { branchId, year: lockRow.year, month: lockRow.month } });
    await tx.periodLock.delete({ where: { id: lockRow.id } });
    await writeAudit(tx, {
      entity: 'period',
      entityId: month,
      action: 'UNLOCK',
      reason,
      before: snap?.figures,
      userId: user.id,
    });
  });
  return periodDto(branchId, month);
}

// ---------------------------------------------------------------- audit log

export async function auditLogs(q: {
  from: string;
  to: string;
  entity?: string;
  q?: string;
  before?: number;
}) {
  const take = 200;
  const where: Prisma.AuditLogWhereInput = {
    createdAt: {
      gte: new Date(`${q.from}T00:00:00+07:00`),
      lt: new Date(Date.parse(`${q.to}T00:00:00+07:00`) + 86400_000),
    },
    ...(q.entity ? { entity: q.entity } : {}),
    ...(q.before ? { id: { lt: q.before } } : {}),
    ...(q.q
      ? {
          OR: [
            { entityId: q.q },
            { reason: { contains: q.q, mode: 'insensitive' } },
            { action: { contains: q.q.toUpperCase() } },
          ],
        }
      : {}),
  };
  const [rows, entities] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, take: take + 1 }),
    prisma.auditLog.findMany({ distinct: ['entity'], select: { entity: true }, orderBy: { entity: 'asc' } }),
  ]);
  const ids = [
    ...new Set(rows.flatMap((r) => [r.userId, r.approvedById]).filter((x): x is number => x != null)),
  ];
  const users = new Map(
    (await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } })).map(
      (u) => [u.id, u.fullName],
    ),
  );
  return {
    rows: rows.slice(0, take).map((r) => ({
      id: r.id,
      entity: r.entity,
      entityId: r.entityId,
      action: r.action,
      reason: r.reason,
      before: r.before,
      after: r.after,
      userName: r.userId ? (users.get(r.userId) ?? null) : null,
      approvedByName: r.approvedById ? (users.get(r.approvedById) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
    })),
    entities: entities.map((e) => e.entity),
    hasMore: rows.length > take,
  };
}
