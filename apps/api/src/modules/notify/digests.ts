// The figures behind the owner's Telegram messages: the day-closing report and the morning digest.
import { prisma } from '../../core/db';
import { defaultBranchId } from '../../core/branch';
import type { DayClosingDto, DayPreview } from '../../contracts/orders.contract';
import type { BackupIssue } from '../../domain/backup/schedule';
import { shopClock } from '../../domain/backup/schedule';
import { fromDbDate, toDbDate } from '../../domain/business-date';
import { dailyReportText, morningText } from '../../domain/notify/messages';
import { businessToday, getSettings } from '../settings/settings.service';
import { stock } from '../inventory/inventory.service';
import { daily, dashboard } from '../reports/reports.service';
import * as bank from '../bank/bank.service';
import * as einvoice from '../einvoice/einvoice.service';

const addDays = (iso: string, n: number) =>
  fromDbDate(new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400_000));

/** The business day before `date` that had sales (null when none in the last week). */
async function previousDay(date: string) {
  const rows = await daily(addDays(date, -7), addDays(date, -1));
  return [...rows].reverse().find((r) => r.orders > 0) ?? null;
}

/** Report sent when a day is closed (preview and closing as just saved). */
export async function dailyReport(p: DayPreview, closing: DayClosingDto, reclose: boolean): Promise<string> {
  const [branch, s, rows, prev] = await Promise.all([
    prisma.branch.findUniqueOrThrow({ where: { id: await defaultBranchId() } }),
    getSettings(),
    daily(p.businessDate, p.businessDate),
    previousDay(p.businessDate),
  ]);
  const row = rows[0];
  return dailyReportText({
    shop: branch.name,
    date: p.businessDate,
    reclose,
    orders: p.paidOrders,
    guests: row?.guests ?? 0,
    netRevenue: p.netRevenue,
    grossProfit: row ? row.grossProfit : null,
    prevNetRevenue: prev?.netRevenue ?? null,
    byMethod: p.byMethod,
    expectedCash: closing.expectedCash,
    countedCash: closing.countedCash,
    cashDiff: closing.diff,
    cashDiffWarn: s.notify_cash_diff,
    discounts: row?.discounts ?? 0,
    cancelled: p.cancelledOrders,
    belowCost: row?.belowCost ?? 0,
    closedBy: closing.closedByName,
    closedAt: closing.closedAt,
    note: closing.note,
    extra: [...(await bank.dailyLines(p.businessDate)), ...(await einvoice.dailyLines(p.businessDate))],
  });
}

const BACKUP_TEXT: Record<BackupIssue, string> = {
  NEVER: 'chưa có bản sao lưu dữ liệu nào',
  FAILED: 'lần sao lưu gần nhất bị lỗi',
  STALE: 'đã hơn 2 ngày chưa có bản sao lưu mới',
  DRIVE_FAILED: 'bản sao lưu chưa gửi được lên Google Drive',
  TELEGRAM_FAILED: 'bản sao lưu chưa gửi được qua Telegram',
};

/** Days before `today` (last 31 days) with sales and no valid closing. */
async function unclosedBefore(today: string) {
  const branchId = await defaultBranchId();
  const from = addDays(today, -31);
  const [sold, closings] = await Promise.all([
    prisma.order.groupBy({
      by: ['businessDate'],
      where: { branchId, status: 'PAID', businessDate: { gte: toDbDate(from), lt: toDbDate(today) } },
    }),
    prisma.dayClosing.findMany({
      where: { branchId, businessDate: { gte: toDbDate(from), lt: toDbDate(today) }, needsReclose: false },
      select: { businessDate: true },
    }),
  ]);
  const closed = new Set(closings.map((c) => fromDbDate(c.businessDate)));
  return sold.map((s) => fromDbDate(s.businessDate)).filter((d) => !closed.has(d));
}

/** "Việc cần chú ý": sent every morning (and on demand from Settings). */
export async function morningDigest(now = new Date()): Promise<string> {
  const today = await businessToday(prisma, now);
  const [d, items, prev, unclosed] = await Promise.all([
    dashboard(),
    stock(),
    previousDay(today),
    unclosedBefore(today),
  ]);
  const yesterdayOpen = prev ? unclosed.includes(prev.day) : false;
  return morningText({
    date: shopClock(now).date,
    yesterday: prev
      ? { date: prev.day, netRevenue: prev.netRevenue, orders: prev.orders, closed: !yesterdayOpen }
      : null,
    lowStock: items.filter((i) => i.status !== 'OK').map((i) => i.name),
    pendingIngredients: d.alerts.pendingIngredients,
    lossDishes: d.alerts.lossDishes,
    overTargetDishes: d.alerts.priceAlerts - d.alerts.lossDishes,
    optionAlerts: d.alerts.optionAlerts,
    staleOpenOrders: d.alerts.staleOpenOrders,
    unclosedDays: unclosed.filter((x) => x !== prev?.day).length,
    backup: d.alerts.backup ? BACKUP_TEXT[d.alerts.backup] : null,
    tax: d.tax,
    extra: [...(await bank.morningLines()), ...(await einvoice.morningLines())],
  });
}
