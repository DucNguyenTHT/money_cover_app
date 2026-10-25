import type { DayClosing } from '@prisma/client';
import { prisma, inTx } from '../../core/db';
import { conflict } from '../../core/errors';
import { writeAudit } from '../../core/audit';
import { assertPeriodOpen } from '../../core/period-lock';
import { defaultBranchId } from '../../core/branch';
import type { AuthUser } from '../../core/auth';
import type { DayClosingDto, DayPreview } from '../../contracts/orders.contract';
import { fromDbDate, toDbDate } from '../../domain/business-date';
import { PAYMENT_METHODS, type PaymentMethod } from '../../domain/enums';
import { D, ZERO } from '../../domain/money';
import { logger } from '../../core/logger';
import { dayTotals } from '../cash/cash.service';
import * as notify from '../notify/notify.service';
import { dailyReport } from '../notify/digests';
import { dayTransfer } from '../bank/bank.service';

const emptyByMethod = () =>
  Object.fromEntries(PAYMENT_METHODS.map((m) => [m, '0'])) as Record<PaymentMethod, string>;

async function toDto(c: DayClosing): Promise<DayClosingDto> {
  const u = await prisma.user.findUnique({ where: { id: c.closedById }, select: { fullName: true } });
  return {
    businessDate: fromDbDate(c.businessDate),
    expectedCash: c.expectedCash.toString(),
    countedCash: c.countedCash.toString(),
    diff: c.diff.toString(),
    expectedByMethod: { ...emptyByMethod(), ...(c.expectedByMethod as Record<PaymentMethod, string>) },
    note: c.note,
    needsReclose: c.needsReclose,
    closedByName: u?.fullName ?? '',
    closedAt: c.closedAt.toISOString(),
  };
}

export async function preview(date: string): Promise<DayPreview> {
  const branchId = await defaultBranchId();
  const day = toDbDate(date);
  const orders = await prisma.order.findMany({
    where: { branchId, businessDate: day },
    include: { payments: true },
  });
  const paid = orders.filter((o) => o.status === 'PAID');
  const byMethod = new Map<PaymentMethod, ReturnType<typeof D>>(PAYMENT_METHODS.map((m) => [m, ZERO]));
  for (const o of paid)
    for (const p of o.payments) byMethod.set(p.method, byMethod.get(p.method)!.add(p.amount.toString()));
  const sum = (f: (o: (typeof paid)[number]) => { toString(): string }) =>
    paid.reduce((s, o) => s.add(f(o).toString()), ZERO).toString();
  const book = await dayTotals(prisma, branchId, date);
  const cashSales = byMethod.get('CASH')!;
  const closing = await prisma.dayClosing.findUnique({
    where: { branchId_businessDate: { branchId, businessDate: day } },
  });
  return {
    businessDate: date,
    openOrders: orders.filter((o) => o.status === 'OPEN').length,
    paidOrders: paid.length,
    cancelledOrders: orders.filter((o) => o.status === 'CANCELLED' && o.cancelKind === 'CANCELLED').length,
    netRevenue: sum((o) => o.netRevenue),
    vatAmount: sum((o) => o.vatAmount),
    total: sum((o) => o.total),
    byMethod: Object.fromEntries([...byMethod].map(([m, v]) => [m, v.toString()])) as Record<
      PaymentMethod,
      string
    >,
    cashSales: cashSales.toString(),
    cashIn: book.in.toString(),
    cashOut: book.out.toString(),
    expectedCash: cashSales.add(book.in).sub(book.out).toString(),
    closing: closing ? await toDto(closing) : null,
    transfer: await dayTransfer(date),
  };
}

export async function close(user: AuthUser, date: string, countedCash: string, note: string | null) {
  const p = await preview(date);
  if (p.openOrders > 0)
    throw conflict(
      'OPEN_ORDERS',
      `Còn ${p.openOrders} đơn chưa thanh toán trong ngày — thanh toán hoặc huỷ trước khi chốt`,
    );
  const branchId = await defaultBranchId();
  const data = {
    expectedCash: p.expectedCash,
    countedCash,
    diff: D(countedCash).sub(p.expectedCash).toString(),
    expectedByMethod: p.byMethod,
    note,
    needsReclose: false,
    closedById: user.id,
    closedAt: new Date(),
  };
  const row = await inTx(async (tx) => {
    await assertPeriodOpen(tx, date);
    const saved = await tx.dayClosing.upsert({
      where: { branchId_businessDate: { branchId, businessDate: toDbDate(date) } },
      update: data,
      create: { branchId, businessDate: toDbDate(date), ...data },
    });
    await writeAudit(tx, {
      entity: 'day_closing',
      entityId: date,
      action: p.closing ? 'RECLOSE' : 'CLOSE',
      before: p.closing,
      after: data,
      userId: user.id,
    });
    return saved;
  });
  const dto = await toDto(row);
  // The owner's report never stands in the way of closing the day.
  try {
    await notify.enqueue(
      prisma,
      'DAILY',
      await dailyReport(p, dto, !!p.closing),
      `DAILY:${date}:${row.closedAt.toISOString()}`,
    );
  } catch (e) {
    logger.error(e, 'Không tạo được báo cáo chốt ngày');
  }
  return dto;
}

export async function list(month: string) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const from = `${month}-01`;
  const to = fromDbDate(new Date(Date.UTC(y, m, 0)));
  const rows = await prisma.dayClosing.findMany({
    where: { branchId: await defaultBranchId(), businessDate: { gte: toDbDate(from), lte: toDbDate(to) } },
    orderBy: { businessDate: 'desc' },
  });
  return Promise.all(rows.map(toDto));
}
