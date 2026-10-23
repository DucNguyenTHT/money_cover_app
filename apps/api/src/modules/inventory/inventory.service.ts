import type { Prisma } from '@prisma/client';
import { prisma, inTx, type Db, type Tx } from '../../core/db';
import { badRequest, notFound } from '../../core/errors';
import { writeAudit } from '../../core/audit';
import { assertPeriodOpen } from '../../core/period-lock';
import { defaultBranchId } from '../../core/branch';
import { fromDbDate, toDbDate } from '../../domain/business-date';
import { D, ZERO, roundVnd, sum, type Decimal } from '../../domain/money';
import { reorder } from '../../domain/inventory/reorder';
import { toStockUnits } from '../../domain/inventory/fifo';
import { businessToday, getSettings } from '../settings/settings.service';
import * as supplierSvc from '../suppliers/suppliers.service';
import type {
  IssueDetail,
  IssueInput,
  IssueSummary,
  ReceiptDetail,
  ReceiptInput,
  ReceiptSummary,
} from '../../contracts/inventory.contract';
import {
  assertLotsUnused,
  createIssueFromLots,
  deleteIssueRestoringLots,
  settlePendingWithLot,
} from './stock-engine';

const s = (d: Prisma.Decimal | null | undefined) => (d == null ? '0' : d.toString());

async function userNames(db: Db, ids: number[]) {
  const users = await db.user.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, fullName: true },
  });
  return new Map(users.map((u) => [u.id, u.fullName]));
}

async function lockedMonths(db: Db, branchId: number) {
  const locks = await db.periodLock.findMany({ where: { branchId } });
  return new Set(locks.map((l) => `${l.year}-${String(l.month).padStart(2, '0')}`));
}

const monthRange = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return { gte: toDbDate(`${month}-01`), lt: toDbDate(`${next}-01`) };
};

// ---------------------------------------------------------------- receipts

type ReceiptRow = Prisma.ReceiptGetPayload<{
  include: {
    items: { include: { ingredient: true; lot: true } };
    _count: { select: { documents: { where: { deletedAt: null } } } };
  };
}>;

function receiptView(
  r: ReceiptRow,
  names: Map<number, string>,
  locked: Set<string>,
  paid: Map<number, Decimal>,
): ReceiptDetail {
  const items = r.items.map((i) => ({
    ingredientId: i.ingredientId,
    ingredientName: i.ingredient.name,
    unit: i.ingredient.unit,
    qty: s(i.qty),
    unitPrice: s(i.unitPrice),
    purchaseUnit: i.purchaseUnitQty ? i.ingredient.purchaseUnit : null,
    purchaseUnitQty: i.purchaseUnitQty?.toString() ?? null,
    amount: s(i.amount),
    consumedQty: i.lot ? D(i.lot.qtyIn.toString()).sub(i.lot.qtyRemaining.toString()).toString() : '0',
  }));
  const date = fromDbDate(r.date);
  return {
    id: r.id,
    kind: r.kind,
    date,
    supplier: r.supplier,
    supplierId: r.supplierId,
    paid: r.supplierId !== null && r.kind === 'PURCHASE' ? (paid.get(r.id) ?? ZERO).toString() : null,
    note: r.note,
    itemCount: items.length,
    total: sum(items.map((i) => i.amount)).toString(),
    createdBy: names.get(r.createdById) ?? '',
    consumed: items.some((i) => D(i.consumedQty).gt(0)),
    locked: locked.has(date.slice(0, 7)),
    documentCount: r._count.documents,
    items,
  };
}

const receiptInclude = {
  items: { include: { ingredient: true, lot: true }, orderBy: { id: 'asc' } },
  _count: { select: { documents: { where: { deletedAt: null } } } },
} as const;

export async function listReceipts(month: string): Promise<ReceiptSummary[]> {
  const branchId = await defaultBranchId();
  const rows = await prisma.receipt.findMany({
    where: { branchId, date: monthRange(month) },
    include: receiptInclude,
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
  });
  const names = await userNames(
    prisma,
    rows.map((r) => r.createdById),
  );
  const locked = await lockedMonths(prisma, branchId);
  const paid = await supplierSvc.receiptPaid(
    prisma,
    rows.flatMap((r) => (r.supplierId === null ? [] : [r.supplierId])),
  );
  return rows.map((r) => {
    const { items: _items, note: _note, ...summary } = receiptView(r, names, locked, paid);
    return summary;
  });
}

export async function getReceipt(id: number, db: Db = prisma): Promise<ReceiptDetail> {
  const r = await db.receipt.findUnique({ where: { id }, include: receiptInclude });
  if (!r) throw notFound('Phiếu nhập');
  return receiptView(
    r,
    await userNames(db, [r.createdById]),
    await lockedMonths(db, r.branchId),
    await supplierSvc.receiptPaid(db, r.supplierId === null ? [] : [r.supplierId]),
  );
}

/** Supplier names for the receipt form's suggestions. */
export async function suppliers() {
  const rows = await prisma.supplier.findMany({
    where: { active: true },
    select: { name: true },
    orderBy: { name: 'asc' },
  });
  return rows.map((r) => r.name);
}

/** Purchases belong to a supplier; one paid on the spot without a supplier name goes to "Mua lẻ". */
const receiptSupplier = (tx: Tx, input: ReceiptInput, paying: boolean) =>
  input.kind === 'PURCHASE'
    ? supplierSvc.resolveTx(tx, input.supplier || (paying ? supplierSvc.WALK_IN_SUPPLIER : null))
    : Promise.resolve(null);

async function writeReceipt(
  tx: Tx,
  branchId: number,
  userId: number,
  input: ReceiptInput,
  supplier: { id: number; name: string } | null,
) {
  const ings = await tx.ingredient.findMany({
    where: { id: { in: input.items.map((i) => i.ingredientId) } },
  });
  const receipt = await tx.receipt.create({
    data: {
      branchId,
      kind: input.kind,
      date: toDbDate(input.date),
      supplier: supplier?.name ?? null,
      supplierId: supplier?.id ?? null,
      note: input.note || null,
      createdById: userId,
    },
  });
  let total = ZERO;
  for (const line of input.items) {
    const ing = ings.find((i) => i.id === line.ingredientId);
    if (!ing) throw badRequest('Nguyên liệu không tồn tại');
    const usePurchase = line.unitMode === 'PURCHASE' && ing.purchaseUnit;
    const conv = usePurchase
      ? toStockUnits(line.qty, line.unitPrice, ing.purchaseFactor.toString())
      : { qty: D(line.qty), unitPrice: D(line.unitPrice) };
    const amount = roundVnd(D(line.qty).mul(line.unitPrice));
    total = total.add(amount);
    const item = await tx.receiptItem.create({
      data: {
        receiptId: receipt.id,
        ingredientId: ing.id,
        qty: conv.qty.toString(),
        unitPrice: conv.unitPrice.toDecimalPlaces(4).toString(),
        purchaseUnitQty: usePurchase ? line.qty : null,
        amount: amount.toString(),
      },
    });
    const lot = await tx.lot.create({
      data: {
        branchId,
        ingredientId: ing.id,
        date: toDbDate(input.date),
        unitPrice: conv.unitPrice.toDecimalPlaces(4).toString(),
        qtyIn: conv.qty.toString(),
        qtyRemaining: conv.qty.toString(),
        receiptItemId: item.id,
      },
    });
    await settlePendingWithLot(tx, lot.id);
  }
  return { id: receipt.id, total };
}

export async function createReceipt(userId: number, input: ReceiptInput) {
  const branchId = await defaultBranchId();
  const id = await inTx(async (tx) => {
    await assertPeriodOpen(tx, input.date);
    const pay = input.kind === 'PURCHASE' ? (input.payment ?? null) : null;
    const supplier = await receiptSupplier(tx, input, pay !== null);
    const { id, total } = await writeReceipt(tx, branchId, userId, input, supplier);
    if (pay && supplier) {
      const amount = pay.amount === null ? total : D(pay.amount);
      if (amount.gt(total)) throw badRequest('Số tiền trả ngay lớn hơn tổng tiền phiếu');
      if (amount.gt(0))
        await supplierSvc.payTx(
          tx,
          supplier.id,
          { date: input.date, amount: amount.toString(), method: pay.method, receiptId: id, note: null },
          userId,
        );
    }
    await writeAudit(tx, { entity: 'receipt', entityId: id, action: 'CREATE', after: input, userId });
    return id;
  });
  return getReceipt(id);
}

async function removeReceipt(tx: Tx, id: number) {
  const items = await tx.receiptItem.findMany({ where: { receiptId: id }, include: { lot: true } });
  const lotIds = items.flatMap((i) => (i.lot ? [i.lot.id] : []));
  await assertLotsUnused(tx, lotIds);
  await tx.lot.deleteMany({ where: { id: { in: lotIds } } });
  await tx.receipt.delete({ where: { id } });
}

export async function updateReceipt(userId: number, id: number, input: ReceiptInput & { reason: string }) {
  const before = await getReceipt(id);
  const branchId = await defaultBranchId();
  const newId = await inTx(async (tx) => {
    await assertPeriodOpen(tx, before.date);
    await assertPeriodOpen(tx, input.date);
    // The receipt is rewritten under a new id: attached invoices and payments follow it.
    const docs = await tx.document.findMany({ where: { receiptId: id }, select: { id: true } });
    const payments = await tx.supplierPayment.findMany({ where: { receiptId: id } });
    const paying = payments.some((p) => !p.cancelledAt);
    if (paying && input.kind !== 'PURCHASE')
      throw badRequest('Phiếu đã có tiền trả nhà cung cấp — không đổi thành phiếu tồn đầu được');
    const supplier = await receiptSupplier(tx, input, paying);
    await removeReceipt(tx, id);
    const { id: newId } = await writeReceipt(tx, branchId, userId, input, supplier);
    if (docs.length)
      await tx.document.updateMany({
        where: { id: { in: docs.map((d) => d.id) } },
        data: { receiptId: newId },
      });
    if (payments.length) await supplierSvc.relinkPaymentsTx(tx, payments, newId, supplier);
    await writeAudit(tx, {
      entity: 'receipt',
      entityId: id,
      action: 'UPDATE',
      reason: input.reason,
      before,
      after: { ...input, newId },
      userId,
    });
    return newId;
  });
  return getReceipt(newId);
}

export async function deleteReceipt(userId: number, id: number, reason: string) {
  const before = await getReceipt(id);
  await inTx(async (tx) => {
    await assertPeriodOpen(tx, before.date);
    await supplierSvc.cancelReceiptPaymentsTx(
      tx,
      id,
      `Xoá phiếu nhập PN${String(id).padStart(6, '0')}: ${reason}`,
      userId,
    );
    await removeReceipt(tx, id);
    await writeAudit(tx, { entity: 'receipt', entityId: id, action: 'DELETE', reason, before, userId });
  });
  return { ok: true as const };
}

// ---------------------------------------------------------------- issues

type IssueRow = Prisma.IssueGetPayload<{
  include: { items: { include: { ingredient: true; allocations: { include: { lot: true } } } } };
}>;
const issueInclude = {
  items: { include: { ingredient: true, allocations: { include: { lot: true } } }, orderBy: { id: 'asc' } },
} as const;

function issueView(i: IssueRow, names: Map<number, string>, locked: Set<string>): IssueDetail {
  const date = fromDbDate(i.date);
  return {
    id: i.id,
    reason: i.reason,
    date,
    note: i.note,
    itemCount: i.items.length,
    costTotal: sum(i.items.map((x) => x.costTotal.toString())).toString(),
    pendingQty: sum(i.items.map((x) => x.pendingQty.toString())).toString(),
    orderId: i.orderId,
    createdBy: names.get(i.createdById) ?? '',
    locked: locked.has(date.slice(0, 7)),
    items: i.items.map((x) => ({
      ingredientId: x.ingredientId,
      ingredientName: x.ingredient.name,
      unit: x.ingredient.unit,
      qty: s(x.qty),
      costTotal: s(x.costTotal),
      pendingQty: s(x.pendingQty),
      allocations: x.allocations.map((a) => ({
        lotId: a.lotId,
        lotDate: fromDbDate(a.lot.date),
        qty: s(a.qty),
        unitPrice: s(a.unitPrice),
      })),
    })),
  };
}

export async function listIssues(month: string, reason?: IssueSummary['reason']): Promise<IssueSummary[]> {
  const branchId = await defaultBranchId();
  const rows = await prisma.issue.findMany({
    where: { branchId, date: monthRange(month), ...(reason ? { reason } : {}) },
    include: issueInclude,
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
  });
  const names = await userNames(
    prisma,
    rows.map((r) => r.createdById),
  );
  const locked = await lockedMonths(prisma, branchId);
  return rows.map((r) => {
    const { items: _items, ...summary } = issueView(r, names, locked);
    return summary;
  });
}

export async function getIssue(id: number): Promise<IssueDetail> {
  const r = await prisma.issue.findUnique({ where: { id }, include: issueInclude });
  if (!r) throw notFound('Phiếu xuất');
  return issueView(r, await userNames(prisma, [r.createdById]), await lockedMonths(prisma, r.branchId));
}

export async function createIssue(userId: number, input: IssueInput) {
  if (input.reason === 'SUPPLIER_RETURN' && input.items.some((i) => !i.lotId)) {
    throw badRequest('Trả nhà cung cấp: chọn lô hàng cho từng dòng');
  }
  const branchId = await defaultBranchId();
  const { issueId } = await inTx(async (tx) => {
    await assertPeriodOpen(tx, input.date);
    const r = await createIssueFromLots(tx, {
      branchId,
      date: input.date,
      reason: input.reason,
      note: input.note,
      createdById: userId,
      allowPending: false,
      lines: input.items.map((i) => ({
        ingredientId: i.ingredientId,
        qty: i.qty,
        lotId: input.reason === 'SUPPLIER_RETURN' ? i.lotId : null,
      })),
    });
    await writeAudit(tx, { entity: 'issue', entityId: r.issueId, action: 'CREATE', after: input, userId });
    return r;
  });
  return getIssue(issueId);
}

export async function deleteIssue(userId: number, id: number, reason: string) {
  const before = await getIssue(id);
  if (before.reason === 'SALE_USE' || before.orderId) {
    throw badRequest('Phiếu tiêu hao do bán hàng tự sinh — huỷ đơn hàng để hoàn kho');
  }
  await inTx(async (tx) => {
    await assertPeriodOpen(tx, before.date);
    await deleteIssueRestoringLots(tx, id);
    await writeAudit(tx, { entity: 'issue', entityId: id, action: 'DELETE', reason, before, userId });
  });
  return { ok: true as const };
}

// ---------------------------------------------------------------- stock views

/** Recent use is averaged over this many days. */
const USAGE_DAYS = 14;

export async function stock() {
  const branchId = await defaultBranchId();
  const s = await getSettings();
  const today = await businessToday();
  const since = toDbDate(
    new Date(Date.parse(`${today}T00:00:00Z`) - USAGE_DAYS * 86400_000).toISOString().slice(0, 10),
  );
  const [ings, lots, pending, last, used] = await Promise.all([
    prisma.ingredient.findMany({ where: { active: true }, orderBy: [{ category: 'asc' }, { name: 'asc' }] }),
    prisma.lot.findMany({ where: { branchId, qtyRemaining: { gt: 0 } } }),
    prisma.issueItem.groupBy({
      by: ['ingredientId'],
      where: { pendingQty: { gt: 0 }, issue: { branchId } },
      _sum: { pendingQty: true },
    }),
    prisma.lot.findMany({
      where: { branchId },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      distinct: ['ingredientId'],
    }),
    // Recent use: everything that left the kitchen (not supplier returns), last USAGE_DAYS days before today.
    prisma.issueItem.groupBy({
      by: ['ingredientId'],
      where: {
        issue: {
          branchId,
          reason: { in: ['SALE_USE', 'INTERNAL_USE', 'DISPOSAL'] },
          date: { gte: since, lt: toDbDate(today) },
        },
      },
      _sum: { qty: true },
    }),
  ]);
  return ings.map((ing) => {
    const own = lots.filter((l) => l.ingredientId === ing.id);
    const qty = sum(own.map((l) => l.qtyRemaining.toString()));
    const value = roundVnd(
      own.reduce((acc, l) => acc.add(D(l.qtyRemaining.toString()).mul(l.unitPrice.toString())), ZERO),
    );
    const p = pending.find((x) => x.ingredientId === ing.id)?._sum.pendingQty;
    const lp = last.find((l) => l.ingredientId === ing.id)?.unitPrice;
    return {
      ingredientId: ing.id,
      code: ing.code,
      name: ing.name,
      kind: ing.kind,
      category: ing.category,
      unit: ing.unit,
      qtyOnHand: qty.toString(),
      pendingQty: p ? p.toString() : '0',
      value: value.toString(),
      lastPrice: lp ? lp.toString() : null,
      ...reorderFields(
        ing,
        qty,
        p?.toString() ?? '0',
        used.find((u) => u.ingredientId === ing.id)?._sum.qty,
        s,
      ),
    };
  });
}

/** Recent pace and the reorder suggestion of one ingredient. */
function reorderFields(
  ing: { minStock: Prisma.Decimal | null; purchaseUnit: string | null; purchaseFactor: Prisma.Decimal },
  onHand: Decimal,
  pending: string,
  usedQty: Prisma.Decimal | null | undefined,
  s: { reorder_days: number },
) {
  const dailyUse = D(usedQty?.toString() ?? 0).div(USAGE_DAYS);
  const factor = ing.purchaseUnit ? ing.purchaseFactor.toString() : '1';
  const r = reorder({
    onHand,
    pending,
    minStock: ing.minStock?.toString() ?? null,
    dailyUse,
    days: s.reorder_days,
    purchaseFactor: factor,
  });
  return {
    minStock: ing.minStock?.toString() ?? null,
    dailyUse: dailyUse.toDecimalPlaces(3).toString(),
    daysLeft: r.daysLeft,
    status: r.status,
    suggestQty: r.suggest.toString(),
    suggestPurchaseQty: r.suggestPurchase.toString(),
    purchaseUnit: ing.purchaseUnit,
    purchaseFactor: factor,
  };
}

export async function lots(ingredientId: number, openOnly: boolean) {
  const branchId = await defaultBranchId();
  const rows = await prisma.lot.findMany({
    where: { branchId, ingredientId, ...(openOnly ? { qtyRemaining: { gt: 0 } } : {}) },
    include: { receiptItem: { include: { receipt: true } } },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
  });
  return rows.map((l) => ({
    id: l.id,
    date: fromDbDate(l.date),
    unitPrice: s(l.unitPrice),
    qtyIn: s(l.qtyIn),
    qtyRemaining: s(l.qtyRemaining),
    source: l.receiptItem
      ? l.receiptItem.receipt.kind === 'OPENING'
        ? 'Tồn đầu'
        : (l.receiptItem.receipt.supplier ?? 'Phiếu nhập #' + l.receiptItem.receipt.id)
      : 'Thừa khi kiểm kê',
  }));
}

export async function pending() {
  const branchId = await defaultBranchId();
  const rows = await prisma.issueItem.findMany({
    where: { pendingQty: { gt: 0 }, issue: { branchId } },
    include: { issue: true, ingredient: true },
    orderBy: [{ issue: { date: 'asc' } }, { id: 'asc' }],
  });
  return rows.map((r) => ({
    issueItemId: r.id,
    issueId: r.issueId,
    date: fromDbDate(r.issue.date),
    reason: r.issue.reason,
    orderId: r.issue.orderId,
    ingredientId: r.ingredientId,
    ingredientName: r.ingredient.name,
    unit: r.ingredient.unit,
    pendingQty: s(r.pendingQty),
    pendingUnitPrice: r.pendingUnitPrice?.toString() ?? null,
  }));
}

export async function priceHistory(ingredientId: number) {
  const rows = await prisma.receiptItem.findMany({
    where: { ingredientId, receipt: { kind: 'PURCHASE' } },
    include: { receipt: true },
    orderBy: [{ receipt: { date: 'asc' } }, { id: 'asc' }],
  });
  return rows.map((r) => ({
    receiptId: r.receiptId,
    date: fromDbDate(r.receipt.date),
    supplier: r.receipt.supplier,
    qty: s(r.qty),
    unitPrice: s(r.unitPrice),
  }));
}
