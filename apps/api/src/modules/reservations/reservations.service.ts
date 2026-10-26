// Table reservations (đặt bàn). A cash deposit goes into the till on the day it is taken (automatic cash book entry).
// When the order opened from the booking is paid, the bill is taken in full (cash / transfer) while the guests hand
// over only the rest, so a cash deposit leaves the till again that day — both days' cash counts stay right.
import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { prisma, inTx, type Db, type Tx } from '../../core/db';
import { badRequest, conflict, notFound } from '../../core/errors';
import { writeAudit } from '../../core/audit';
import { defaultBranchId } from '../../core/branch';
import type { AuthUser } from '../../core/auth';
import type { ReservationDto, reservationInput } from '../../contracts/reservations.contract';
import { businessDateOf, fromDbDate, toDbDate } from '../../domain/business-date';
import { D, Decimal } from '../../domain/money';
import { normalizePhone } from '../../domain/loyalty/points';
import {
  overlaps,
  reservationProblem,
  reservationsLine,
  shopTime,
} from '../../domain/reservations/reservations';
import * as cash from '../cash/cash.service';
import { businessToday, getSettings } from '../settings/settings.service';

type Input = z.infer<typeof reservationInput>;

const include = {
  customer: { select: { name: true } },
  table: { select: { name: true } },
  order: { select: { code: true, status: true } },
} as const;
type Row = Prisma.ReservationGetPayload<{ include: typeof include }>;

async function names(db: Db, ids: number[]) {
  const rows = await db.user.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, fullName: true },
  });
  return new Map(rows.map((u) => [u.id, u.fullName]));
}

const toDto = (r: Row, who: Map<number, string>): ReservationDto => ({
  id: r.id,
  name: r.name,
  phone: r.phone,
  customerId: r.customerId,
  customerName: r.customer?.name ?? null,
  guests: r.guests,
  reservedAt: r.reservedAt.toISOString(),
  businessDate: fromDbDate(r.businessDate),
  durationMin: r.durationMin,
  tableId: r.tableId,
  tableName: r.table?.name ?? null,
  note: r.note,
  deposit: r.deposit.toString(),
  depositMethod: r.depositMethod === 'CASH' || r.depositMethod === 'TRANSFER' ? r.depositMethod : null,
  depositOutcome: r.depositOutcome,
  status: r.status,
  orderId: r.orderId,
  orderCode: r.order?.code ?? null,
  cancelReason: r.cancelReason,
  createdByName: who.get(r.createdById) ?? '',
  createdAt: r.createdAt.toISOString(),
});

async function one(id: number) {
  const r = await prisma.reservation.findUnique({ where: { id }, include });
  if (!r) throw notFound('Không tìm thấy đặt bàn');
  return toDto(r, await names(prisma, [r.createdById]));
}

export async function list(from: string, to: string) {
  const rows = await prisma.reservation.findMany({
    where: { branchId: await defaultBranchId(), businessDate: { gte: toDbDate(from), lte: toDbDate(to) } },
    include,
    orderBy: [{ reservedAt: 'asc' }, { id: 'asc' }],
  });
  const who = await names(
    prisma,
    rows.map((r) => r.createdById),
  );
  return rows.map((r) => toDto(r, who));
}

const dm = (iso: string) => {
  const d = new Date(Date.parse(iso) + 7 * 3600_000).toISOString();
  return `${d.slice(8, 10)}/${d.slice(5, 7)}`;
};

/** Checks a booking and works out what to store. */
async function prepare(tx: Tx, b: Input, self: { id: number; reservedAt: Date } | null) {
  // Editing a booking whose time has passed (a note, the table) is fine; moving one into the past is not.
  const moved = !self || self.reservedAt.toISOString() !== new Date(b.reservedAt).toISOString();
  const problem = reservationProblem(b, moved ? new Date() : new Date(0));
  if (problem) throw badRequest(problem);
  const s = await getSettings(tx);
  let customerId: number | null = null;
  let phone: string | null = null;
  if (b.phone) {
    phone = normalizePhone(b.phone);
    if (!phone) throw badRequest('Số điện thoại không hợp lệ');
    customerId = (await tx.customer.findUnique({ where: { phone } }))?.id ?? null;
  }
  if (b.tableId !== null) {
    const t = await tx.diningTable.findUnique({ where: { id: b.tableId } });
    if (!t || !t.active) throw badRequest('Bàn không tồn tại');
    const others = await tx.reservation.findMany({
      where: { tableId: b.tableId, status: 'BOOKED', ...(self ? { id: { not: self.id } } : {}) },
    });
    const slot = { reservedAt: new Date(b.reservedAt).toISOString(), durationMin: b.durationMin };
    const clash = others.find((o) =>
      overlaps(slot, { reservedAt: o.reservedAt.toISOString(), durationMin: o.durationMin }),
    );
    if (clash) {
      const end = new Date(clash.reservedAt.getTime() + clash.durationMin * 60_000).toISOString();
      throw conflict(
        'TABLE_BOOKED',
        `${t.name} đã có khách đặt ${dm(clash.reservedAt.toISOString())} ${shopTime(clash.reservedAt.toISOString())}–${shopTime(end)} (${clash.name})`,
      );
    }
  }
  const deposit = D(b.deposit).round();
  return {
    name: b.name,
    phone,
    customerId,
    guests: b.guests,
    reservedAt: new Date(b.reservedAt),
    businessDate: toDbDate(businessDateOf(new Date(b.reservedAt), s.business_day_start)),
    durationMin: b.durationMin,
    tableId: b.tableId,
    note: b.note || null,
    deposit: deposit.toString(),
    depositMethod: deposit.gt(0) ? b.depositMethod : null,
  };
}

/** A cash deposit is money put in the till today. */
async function takeDepositTx(
  tx: Tx,
  r: {
    id: number;
    name: string;
    reservedAt: Date;
    deposit: string;
    depositMethod: 'CASH' | 'TRANSFER' | null;
  },
  userId: number,
) {
  if (r.depositMethod !== 'CASH' || !D(r.deposit).gt(0)) return;
  const at = r.reservedAt.toISOString();
  await cash.addTx(
    tx,
    {
      businessDate: await businessToday(tx),
      direction: 'IN',
      category: 'Tiền cọc đặt bàn',
      amount: r.deposit,
      note: `${r.name} — đặt ${dm(at)} ${shopTime(at)}`,
      source: 'RESERVATION',
      sourceId: r.id,
    },
    userId,
  );
}

export async function create(user: AuthUser, b: Input) {
  const id = await inTx(async (tx) => {
    const data = await prepare(tx, b, null);
    const r = await tx.reservation.create({
      data: { ...data, branchId: await defaultBranchId(), createdById: user.id },
    });
    await takeDepositTx(tx, { ...data, id: r.id }, user.id);
    await writeAudit(tx, {
      entity: 'reservation',
      entityId: r.id,
      action: 'CREATE',
      after: b,
      userId: user.id,
    });
    return r.id;
  });
  return one(id);
}

export async function update(user: AuthUser, id: number, b: Input) {
  await inTx(async (tx) => {
    const before = await tx.reservation.findUnique({ where: { id } });
    if (!before) throw notFound('Không tìm thấy đặt bàn');
    if (before.status !== 'BOOKED') throw badRequest('Chỉ sửa được đặt bàn chưa đến');
    const data = await prepare(tx, b, before);
    await tx.reservation.update({ where: { id }, data });
    // Deposit changed: the old cash entry is cancelled, the new amount taken today.
    if (!before.deposit.equals(data.deposit) || before.depositMethod !== data.depositMethod) {
      await cash.cancelBySourceTx(tx, 'RESERVATION', id, 'Sửa tiền cọc đặt bàn', user.id);
      await takeDepositTx(tx, { ...data, id }, user.id);
    }
    await writeAudit(tx, {
      entity: 'reservation',
      entityId: id,
      action: 'UPDATE',
      before: { ...before, deposit: before.deposit.toString() },
      after: b,
      userId: user.id,
    });
  });
  return one(id);
}

/**
 * Booking cancelled or the guests never came (also an arrived booking whose order was cancelled). A deposit is given
 * back (cash leaves the till today) or kept.
 */
export async function cancel(
  user: AuthUser,
  id: number,
  b: { status: 'CANCELLED' | 'NO_SHOW'; reason: string; refund: boolean },
) {
  await inTx(async (tx) => {
    const r = await tx.reservation.findUnique({ where: { id }, include: { order: true } });
    if (!r) throw notFound('Không tìm thấy đặt bàn');
    const orderGone = r.status === 'ARRIVED' && (!r.order || r.order.status === 'CANCELLED');
    if (r.status !== 'BOOKED' && !orderGone) throw badRequest('Đặt bàn này đã xử lý xong');
    const held = r.deposit.gt(0) && !r.depositOutcome;
    if (held && b.refund && r.depositMethod === 'CASH')
      await cash.addTx(
        tx,
        {
          businessDate: await businessToday(tx),
          direction: 'OUT',
          category: 'Hoàn tiền cọc',
          amount: r.deposit.toString(),
          note: `${r.name} — ${b.reason}`,
          source: 'RESERVATION_REFUND',
          sourceId: r.id,
        },
        user.id,
      );
    await tx.reservation.update({
      where: { id },
      data: {
        status: b.status,
        cancelReason: b.reason,
        ...(held ? { depositOutcome: b.refund ? 'REFUNDED' : 'KEPT' } : {}),
      },
    });
    await writeAudit(tx, {
      entity: 'reservation',
      entityId: id,
      action: b.status,
      reason: b.reason,
      after: b,
      userId: user.id,
    });
  });
  return one(id);
}

// ---------------------------------------------------------------- order hooks (orders.service)

/** The order of a booking is opened: the guests arrived. Returns the booking (its customer goes on the order). */
export async function arriveTx(tx: Tx, id: number, orderId: number, tableId: number | null, userId: number) {
  const r = await tx.reservation.findUnique({ where: { id } });
  if (!r) throw notFound('Không tìm thấy đặt bàn');
  if (r.status !== 'BOOKED') throw badRequest('Đặt bàn này đã xử lý (khách đã đến hoặc đã huỷ)');
  await tx.reservation.update({
    where: { id },
    data: { status: 'ARRIVED', orderId, tableId: tableId ?? r.tableId },
  });
  await writeAudit(tx, { entity: 'reservation', entityId: id, action: 'ARRIVE', after: { orderId }, userId });
  return r;
}

/**
 * Paid: the deposit counts towards the bill, inside the payment line of its kind (cash / transfer) so the till and the
 * bank check stay right; a cash deposit leaves the till again (the bill was taken in full).
 */
export async function onOrderPaidTx(
  tx: Tx,
  o: { id: number; code: string; businessDate: string; total: Decimal; cash: Decimal; transfer: Decimal },
  userId: number,
) {
  const r = await tx.reservation.findUnique({ where: { orderId: o.id } });
  if (!r || !r.deposit.gt(0) || r.depositOutcome) return;
  const need = Decimal.min(D(r.deposit.toString()), o.total);
  const amount = need.toNumber().toLocaleString('vi-VN');
  if (r.depositMethod === 'CASH' && o.cash.lt(need))
    throw badRequest(`Khách đã cọc ${amount} tiền mặt — dòng Tiền mặt phải gồm số này`);
  if (r.depositMethod === 'TRANSFER' && o.transfer.lt(need))
    throw badRequest(`Khách đã cọc ${amount} chuyển khoản — dòng Chuyển khoản phải gồm số này`);
  if (r.depositMethod === 'CASH')
    await cash.addTx(
      tx,
      {
        businessDate: o.businessDate,
        direction: 'OUT',
        category: 'Trừ tiền cọc vào đơn',
        amount: r.deposit.toString(),
        note: `Đơn ${o.code} — cọc của ${r.name}`,
        source: 'RESERVATION_USE',
        sourceId: r.id,
      },
      userId,
    );
  await tx.reservation.update({ where: { id: r.id }, data: { depositOutcome: 'USED' } });
}

/** A paid order cancelled: the deposit is held again (give it back or keep it from the booking). */
export async function onOrderCancelledTx(tx: Tx, orderId: number, userId: number) {
  const r = await tx.reservation.findUnique({ where: { orderId } });
  if (!r || r.depositOutcome !== 'USED') return;
  if (r.depositMethod === 'CASH')
    await cash.cancelBySourceTx(tx, 'RESERVATION_USE', r.id, 'Huỷ đơn đã thanh toán', userId);
  await tx.reservation.update({ where: { id: r.id }, data: { depositOutcome: null } });
}

/** Morning message: today's bookings. */
export async function morningLines(): Promise<string[]> {
  const rows = await prisma.reservation.findMany({
    where: {
      branchId: await defaultBranchId(),
      businessDate: toDbDate(await businessToday()),
      status: 'BOOKED',
    },
    include: { table: { select: { name: true } } },
    orderBy: { reservedAt: 'asc' },
  });
  const line = reservationsLine(
    rows.map((r) => ({
      reservedAt: r.reservedAt.toISOString(),
      name: r.name,
      guests: r.guests,
      tableName: r.table?.name ?? null,
    })),
  );
  return line ? [line] : [];
}
