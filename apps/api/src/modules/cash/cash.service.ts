// Cash book (sổ quỹ): money in / out of the till besides sales. Day closing counts it in the cash expected.
import type { CashEntry } from '@prisma/client';
import type { z } from 'zod';
import { prisma, inTx, type Db, type Tx } from '../../core/db';
import { badRequest, forbidden, notFound } from '../../core/errors';
import { writeAudit } from '../../core/audit';
import { assertPeriodOpen } from '../../core/period-lock';
import { defaultBranchId } from '../../core/branch';
import type { AuthUser } from '../../core/auth';
import type { CashEntryDto, cashInput } from '../../contracts/cash.contract';
import { fromDbDate, toDbDate } from '../../domain/business-date';
import { canCancelCash, cashTotals } from '../../domain/cash/cashbook';
import { businessToday } from '../settings/settings.service';

async function names(db: Db, ids: (number | null)[]) {
  const wanted = [...new Set(ids.filter((x): x is number => x !== null))];
  const rows = wanted.length
    ? await db.user.findMany({ where: { id: { in: wanted } }, select: { id: true, fullName: true } })
    : [];
  return new Map(rows.map((u) => [u.id, u.fullName]));
}

function toDto(e: CashEntry, who: Map<number, string>): CashEntryDto {
  return {
    id: e.id,
    businessDate: fromDbDate(e.businessDate),
    direction: e.direction,
    category: e.category,
    amount: e.amount.toString(),
    note: e.note,
    source: e.source,
    createdById: e.createdById,
    createdByName: who.get(e.createdById) ?? '',
    createdAt: e.createdAt.toISOString(),
    cancelled: !!e.cancelledAt,
    cancelReason: e.cancelReason,
    cancelledByName: e.cancelledById ? (who.get(e.cancelledById) ?? '') : null,
  };
}

async function one(id: number, db: Db = prisma) {
  const e = await db.cashEntry.findUnique({ where: { id } });
  if (!e) throw notFound('Khoản thu chi');
  return toDto(e, await names(db, [e.createdById, e.cancelledById]));
}

export async function list(from: string, to: string) {
  const rows = await prisma.cashEntry.findMany({
    where: { branchId: await defaultBranchId(), businessDate: { gte: toDbDate(from), lte: toDbDate(to) } },
    orderBy: [{ businessDate: 'desc' }, { id: 'desc' }],
  });
  const who = await names(
    prisma,
    rows.flatMap((r) => [r.createdById, r.cancelledById]),
  );
  const t = cashTotals(
    rows.map((r) => ({ direction: r.direction, amount: r.amount.toString(), cancelled: !!r.cancelledAt })),
  );
  return { entries: rows.map((r) => toDto(r, who)), totalIn: t.in.toString(), totalOut: t.out.toString() };
}

/** A change to a day already closed: the closing must be redone (the expected cash moved). */
async function touchClosing(tx: Tx, branchId: number, date: string) {
  await tx.dayClosing.updateMany({
    where: { branchId, businessDate: toDbDate(date) },
    data: { needsReclose: true },
  });
}

/** Used by this module and by the screens that pay in cash (supplier payment, payroll). */
export async function addTx(
  tx: Tx,
  input: z.infer<typeof cashInput> & { source?: string | null; sourceId?: number | null },
  userId: number,
) {
  const branchId = await defaultBranchId();
  if (input.businessDate > (await businessToday(tx))) throw badRequest('Không ghi sổ quỹ cho ngày tương lai');
  await assertPeriodOpen(tx, input.businessDate);
  const e = await tx.cashEntry.create({
    data: {
      branchId,
      businessDate: toDbDate(input.businessDate),
      direction: input.direction,
      category: input.category,
      amount: input.amount,
      note: input.note,
      source: input.source ?? null,
      sourceId: input.sourceId ?? null,
      createdById: userId,
    },
  });
  await touchClosing(tx, branchId, input.businessDate);
  await writeAudit(tx, { entity: 'cash_entry', entityId: e.id, action: 'CREATE', after: input, userId });
  return e;
}

export async function create(user: AuthUser, input: z.infer<typeof cashInput>) {
  const e = await inTx((tx) => addTx(tx, input, user.id));
  return one(e.id);
}

/** Cancel an entry made by another screen (that screen checked the rights). */
export async function cancelBySourceTx(
  tx: Tx,
  source: string,
  sourceId: number,
  reason: string,
  userId: number,
) {
  const rows = await tx.cashEntry.findMany({ where: { source, sourceId, cancelledAt: null } });
  for (const e of rows) await cancelRow(tx, e, reason, userId);
}

async function cancelRow(tx: Tx, e: CashEntry, reason: string, userId: number) {
  await assertPeriodOpen(tx, fromDbDate(e.businessDate));
  await tx.cashEntry.update({
    where: { id: e.id },
    data: { cancelledAt: new Date(), cancelledById: userId, cancelReason: reason },
  });
  await touchClosing(tx, e.branchId, fromDbDate(e.businessDate));
  await writeAudit(tx, { entity: 'cash_entry', entityId: e.id, action: 'CANCEL', reason, userId });
}

export async function cancel(user: AuthUser, id: number, reason: string) {
  await inTx(async (tx) => {
    const e = await tx.cashEntry.findUnique({ where: { id } });
    if (!e) throw notFound('Khoản thu chi');
    if (e.cancelledAt) throw badRequest('Khoản này đã huỷ');
    const problem = canCancelCash({
      role: user.role,
      isAuthor: e.createdById === user.id,
      sameDay: fromDbDate(e.businessDate) === (await businessToday(tx)),
      automatic: e.source !== null,
    });
    if (problem) throw forbidden(problem);
    await cancelRow(tx, e, reason, user.id);
  });
  return one(id);
}

/** For day closing: money in / out of the till on one business day. */
export async function dayTotals(db: Db, branchId: number, date: string) {
  const rows = await db.cashEntry.findMany({
    where: { branchId, businessDate: toDbDate(date), cancelledAt: null },
  });
  return cashTotals(
    rows.map((r) => ({ direction: r.direction, amount: r.amount.toString(), cancelled: false })),
  );
}
