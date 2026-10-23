// Suppliers and payables: debt = purchase receipts − payments. Cash payments also go to the cash book.
import type { Supplier, SupplierPayment } from '@prisma/client';
import type { z } from 'zod';
import { prisma, inTx, type Db, type Tx } from '../../core/db';
import { badRequest, conflict, notFound } from '../../core/errors';
import { writeAudit } from '../../core/audit';
import { assertPeriodOpen } from '../../core/period-lock';
import { defaultBranchId } from '../../core/branch';
import type { AuthUser } from '../../core/auth';
import type {
  LedgerEntry,
  SupplierDto,
  supplierInput,
  supplierPaymentInput,
} from '../../contracts/suppliers.contract';
import { fromDbDate, toDbDate } from '../../domain/business-date';
import { D, sum, type Decimal } from '../../domain/money';
import { allocatePayments } from '../../domain/suppliers/payables';
import * as cash from '../cash/cash.service';

/** Supplier of a purchase paid on the spot when no supplier name was typed. */
export const WALK_IN_SUPPLIER = 'Mua lẻ';

const receiptCode = (id: number) => `PN${String(id).padStart(6, '0')}`;
const cashNote = (supplier: string, receiptId: number | null, note: string | null) =>
  [supplier, receiptId ? receiptCode(receiptId) : null, note].filter(Boolean).join(' · ');
const METHOD_LABEL: Record<string, string> = {
  CASH: 'Trả tiền mặt',
  TRANSFER: 'Chuyển khoản',
  OPENING: 'Đã thanh toán trước khi dùng công nợ',
};

/** Purchase receipts (with their totals) and payments of some suppliers. */
async function payables(db: Db, supplierIds: number[]) {
  const [receipts, payments] = await Promise.all([
    db.receipt.findMany({
      where: { supplierId: { in: supplierIds }, kind: 'PURCHASE' },
      select: {
        id: true,
        supplierId: true,
        date: true,
        note: true,
        createdAt: true,
        items: { select: { amount: true } },
      },
    }),
    db.supplierPayment.findMany({ where: { supplierId: { in: supplierIds } }, orderBy: { id: 'asc' } }),
  ]);
  return {
    receipts: receipts.map((r) => ({
      id: r.id,
      supplierId: r.supplierId!,
      date: fromDbDate(r.date),
      amount: sum(r.items.map((i) => i.amount.toString())),
      note: r.note,
      createdAt: r.createdAt,
    })),
    payments,
  };
}
type Payables = Awaited<ReturnType<typeof payables>>;

const live = (payments: SupplierPayment[]) =>
  payments
    .filter((p) => !p.cancelledAt)
    .map((p) => ({ amount: p.amount.toString(), receiptId: p.receiptId }));

/** What is paid on each receipt of these suppliers (oldest receipts first, see allocatePayments). */
export async function receiptPaid(db: Db, supplierIds: number[]) {
  const ids = [...new Set(supplierIds)];
  const out = new Map<number, Decimal>();
  if (!ids.length) return out;
  const data = await payables(db, ids);
  for (const id of ids) {
    const { paid } = allocatePayments(
      data.receipts.filter((r) => r.supplierId === id),
      live(data.payments.filter((p) => p.supplierId === id)),
    );
    for (const [receiptId, v] of paid) out.set(receiptId, v);
  }
  return out;
}

function toDto(s: Supplier, data: Payables): SupplierDto {
  const own = data.receipts.filter((r) => r.supplierId === s.id);
  const purchased = sum(own.map((r) => r.amount));
  const paid = sum(live(data.payments.filter((p) => p.supplierId === s.id)).map((p) => p.amount));
  return {
    id: s.id,
    name: s.name,
    phone: s.phone,
    address: s.address,
    note: s.note,
    active: s.active,
    purchased: purchased.toString(),
    paid: paid.toString(),
    balance: purchased.sub(paid).toString(),
    receiptCount: own.length,
    lastReceiptDate: own.reduce<string | null>((m, r) => (m === null || r.date > m ? r.date : m), null),
  };
}

export async function list() {
  const rows = await prisma.supplier.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }] });
  const data = await payables(
    prisma,
    rows.map((s) => s.id),
  );
  return rows.map((s) => toDto(s, data));
}

async function one(id: number, db: Db = prisma) {
  const s = await db.supplier.findUnique({ where: { id } });
  if (!s) throw notFound('Nhà cung cấp');
  return toDto(s, await payables(db, [id]));
}

export async function save(userId: number, id: number | null, input: z.infer<typeof supplierInput>) {
  const row = await inTx(async (tx) => {
    const clash = await tx.supplier.findFirst({
      where: { name: { equals: input.name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) },
    });
    if (clash) throw conflict('DUPLICATE', `Đã có nhà cung cấp "${clash.name}"`);
    if (id === null) {
      const row = await tx.supplier.create({ data: input });
      await writeAudit(tx, { entity: 'supplier', entityId: row.id, action: 'CREATE', after: input, userId });
      return row;
    }
    const before = await tx.supplier.findUnique({ where: { id } });
    if (!before) throw notFound('Nhà cung cấp');
    const row = await tx.supplier.update({ where: { id }, data: input });
    // Receipts also keep the name as text (receipt list, invoice partner suggestions).
    if (before.name !== input.name)
      await tx.receipt.updateMany({ where: { supplierId: id }, data: { supplier: input.name } });
    await writeAudit(tx, {
      entity: 'supplier',
      entityId: id,
      action: 'UPDATE',
      before,
      after: input,
      userId,
    });
    return row;
  });
  return one(row.id);
}

/** The supplier named on a receipt: the existing one (any letter case) or a new one. */
export async function resolveTx(tx: Tx, name: string | null) {
  const n = name?.trim();
  if (!n) return null;
  return (
    (await tx.supplier.findFirst({ where: { name: { equals: n, mode: 'insensitive' } } })) ??
    (await tx.supplier.create({ data: { name: n } }))
  );
}

/** Record a payment (and, in cash, its cash book entry). */
export async function payTx(
  tx: Tx,
  supplierId: number,
  input: z.infer<typeof supplierPaymentInput>,
  userId: number,
) {
  const s = await tx.supplier.findUnique({ where: { id: supplierId } });
  if (!s) throw notFound('Nhà cung cấp');
  if (input.receiptId !== null) {
    const r = await tx.receipt.findUnique({ where: { id: input.receiptId } });
    if (!r || r.supplierId !== supplierId || r.kind !== 'PURCHASE')
      throw badRequest('Phiếu nhập không thuộc nhà cung cấp này');
  }
  await assertPeriodOpen(tx, input.date);
  const p = await tx.supplierPayment.create({
    data: {
      branchId: await defaultBranchId(),
      supplierId,
      date: toDbDate(input.date),
      amount: input.amount,
      method: input.method,
      receiptId: input.receiptId,
      note: input.note,
      createdById: userId,
    },
  });
  if (input.method === 'CASH')
    await cash.addTx(
      tx,
      {
        businessDate: input.date,
        direction: 'OUT',
        category: 'Trả nhà cung cấp',
        amount: input.amount,
        note: cashNote(s.name, input.receiptId, input.note),
        source: 'SUPPLIER_PAYMENT',
        sourceId: p.id,
      },
      userId,
    );
  await writeAudit(tx, {
    entity: 'supplier_payment',
    entityId: p.id,
    action: 'CREATE',
    after: { supplierId, ...input },
    userId,
  });
  return p;
}

export async function pay(user: AuthUser, supplierId: number, input: z.infer<typeof supplierPaymentInput>) {
  await inTx((tx) => payTx(tx, supplierId, input, user.id));
  return one(supplierId);
}

async function cancelRow(tx: Tx, p: SupplierPayment, reason: string, userId: number) {
  await assertPeriodOpen(tx, fromDbDate(p.date));
  await tx.supplierPayment.update({
    where: { id: p.id },
    data: { cancelledAt: new Date(), cancelledById: userId, cancelReason: reason },
  });
  await cash.cancelBySourceTx(tx, 'SUPPLIER_PAYMENT', p.id, reason, userId);
  await writeAudit(tx, { entity: 'supplier_payment', entityId: p.id, action: 'CANCEL', reason, userId });
}

export async function cancelPayment(user: AuthUser, paymentId: number, reason: string) {
  const supplierId = await inTx(async (tx) => {
    const p = await tx.supplierPayment.findUnique({ where: { id: paymentId } });
    if (!p) throw notFound('Lần trả tiền');
    if (p.cancelledAt) throw badRequest('Lần trả này đã huỷ');
    if (p.method === 'OPENING') throw badRequest('Không huỷ được số đã thanh toán trước khi dùng công nợ');
    await cancelRow(tx, p, reason, user.id);
    return p.supplierId;
  });
  return one(supplierId);
}

/** A receipt rewritten under a new id (edit): its payments follow it, to its supplier if that changed. */
export async function relinkPaymentsTx(
  tx: Tx,
  payments: SupplierPayment[],
  receiptId: number,
  supplier: { id: number; name: string } | null,
) {
  for (const p of payments) {
    await tx.supplierPayment.update({
      where: { id: p.id },
      data: { receiptId, ...(supplier ? { supplierId: supplier.id } : {}) },
    });
    if (supplier)
      await tx.cashEntry.updateMany({
        where: { source: 'SUPPLIER_PAYMENT', sourceId: p.id },
        data: { note: cashNote(supplier.name, receiptId, p.note) },
      });
  }
}

/** A receipt deleted: the money paid for it is cancelled too, with its cash book entries. */
export async function cancelReceiptPaymentsTx(tx: Tx, receiptId: number, reason: string, userId: number) {
  const rows = await tx.supplierPayment.findMany({ where: { receiptId, cancelledAt: null } });
  for (const p of rows) await cancelRow(tx, p, reason, userId);
}

/** Receipts and payments in date order with the running debt (newest first). */
export async function ledger(supplierId: number) {
  const s = await prisma.supplier.findUnique({ where: { id: supplierId } });
  if (!s) throw notFound('Nhà cung cấp');
  const data = await payables(prisma, [supplierId]);
  const { paid } = allocatePayments(data.receipts, live(data.payments));
  type Row = Omit<LedgerEntry, 'balance'> & { at: number; order: number };
  const rows: Row[] = [
    ...data.receipts.map((r) => ({
      date: r.date,
      kind: 'RECEIPT' as const,
      label: receiptCode(r.id),
      receiptId: r.id,
      paymentId: null,
      method: null,
      amount: r.amount.toString(),
      remaining: r.amount.sub(paid.get(r.id) ?? 0).toString(),
      note: r.note,
      cancelled: false,
      cancelReason: null,
      at: r.createdAt.getTime(),
      order: 0,
    })),
    ...data.payments.map((p) => ({
      date: fromDbDate(p.date),
      kind: 'PAYMENT' as const,
      label: METHOD_LABEL[p.method] ?? p.method,
      receiptId: p.receiptId,
      paymentId: p.id,
      method: p.method,
      amount: D(p.amount.toString()).neg().toString(),
      remaining: null,
      note: p.note,
      cancelled: !!p.cancelledAt,
      cancelReason: p.cancelReason,
      at: p.createdAt.getTime(),
      order: 1,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.at - b.at);
  let balance = D(0);
  const entries = rows.map(({ at: _at, order: _order, ...r }): LedgerEntry => {
    if (!r.cancelled) balance = balance.add(r.amount);
    return { ...r, balance: balance.toString() };
  });
  return { supplier: toDto(s, data), entries: entries.reverse() };
}
