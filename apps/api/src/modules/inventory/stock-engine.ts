// Lot bookkeeping shared by receipts, manual issues, sales (step 5) and stocktakes (step 6).
// Every function takes the caller's transaction `tx`.
import type { IssueReason, Prisma } from '@prisma/client';
import type { Tx } from '../../core/db';
import { badRequest, conflict } from '../../core/errors';
import { toDbDate } from '../../domain/business-date';
import { D, Decimal, ZERO, roundVnd } from '../../domain/money';
import { allocateFifo, allocationsCost, settlePending } from '../../domain/inventory/fifo';

interface LockedLot {
  id: number;
  qtyRemaining: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  date: Date;
}

/** Lock the open lots of one ingredient (oldest first). `upTo` limits to lots dated on/before that day. */
export async function lockOpenLots(
  tx: Tx,
  branchId: number,
  ingredientId: number,
  upTo?: string,
): Promise<LockedLot[]> {
  const rows = upTo
    ? await tx.$queryRaw<
        { id: number; qty_remaining: Prisma.Decimal; unit_price: Prisma.Decimal; date: Date }[]
      >`
        SELECT id, qty_remaining, unit_price, date FROM lots
        WHERE branch_id = ${branchId} AND ingredient_id = ${ingredientId} AND qty_remaining > 0 AND date <= ${toDbDate(upTo)}::date
        ORDER BY date, id FOR UPDATE`
    : await tx.$queryRaw<
        { id: number; qty_remaining: Prisma.Decimal; unit_price: Prisma.Decimal; date: Date }[]
      >`
        SELECT id, qty_remaining, unit_price, date FROM lots
        WHERE branch_id = ${branchId} AND ingredient_id = ${ingredientId} AND qty_remaining > 0
        ORDER BY date, id FOR UPDATE`;
  return rows.map((r) => ({
    id: r.id,
    qtyRemaining: r.qty_remaining,
    unitPrice: r.unit_price,
    date: r.date,
  }));
}

/** Latest purchase price of an ingredient (used to value "nợ kho" and stocktake surpluses). */
export async function lastUnitPrice(
  tx: Tx,
  branchId: number,
  ingredientId: number,
  upTo?: string,
): Promise<Decimal | null> {
  const lot = await tx.lot.findFirst({
    where: { branchId, ingredientId, ...(upTo ? { date: { lte: toDbDate(upTo) } } : {}) },
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
  });
  if (lot) return D(lot.unitPrice.toString());
  if (upTo) return lastUnitPrice(tx, branchId, ingredientId);
  return null;
}

export interface IssueLine {
  ingredientId: number;
  qty: Decimal.Value;
  /** Take from this exact lot (supplier return) instead of FIFO. */
  lotId?: number | null;
}

export interface CreateIssueArgs {
  branchId: number;
  date: string;
  reason: IssueReason;
  lines: IssueLine[];
  createdById: number;
  note?: string | null;
  orderId?: number | null;
  orderItemId?: number | null;
  /** Sales may sell what isn't in stock yet ("nợ kho"); manual issues may not. */
  allowPending: boolean;
}

/** Create an issue and take its quantities out of lots. Returns the issue id and total cost. */
export async function createIssueFromLots(
  tx: Tx,
  a: CreateIssueArgs,
): Promise<{ issueId: number; costTotal: Decimal }> {
  // Merge duplicate ingredients and lock in ingredient-id order to avoid deadlocks between concurrent issues.
  const merged = new Map<string, IssueLine & { qtyD: Decimal }>();
  for (const l of a.lines) {
    const key = `${l.ingredientId}:${l.lotId ?? ''}`;
    const prev = merged.get(key);
    merged.set(key, { ...l, qtyD: (prev?.qtyD ?? ZERO).add(D(l.qty)) });
  }
  const lines = [...merged.values()]
    .filter((l) => l.qtyD.gt(0))
    .sort((x, y) => x.ingredientId - y.ingredientId);

  const planned: {
    line: (typeof lines)[number];
    allocs: { lotId: number; qty: Decimal; unitPrice: Decimal }[];
    short: Decimal;
    pendingPrice: Decimal | null;
  }[] = [];
  const shortages: { ingredientId: number; missing: string }[] = [];

  for (const line of lines) {
    if (line.lotId) {
      const [lot] = await tx.$queryRaw<
        { id: number; ingredient_id: number; qty_remaining: Prisma.Decimal; unit_price: Prisma.Decimal }[]
      >`
        SELECT id, ingredient_id, qty_remaining, unit_price FROM lots WHERE id = ${line.lotId} AND branch_id = ${a.branchId} FOR UPDATE`;
      if (!lot || lot.ingredient_id !== line.ingredientId) throw badRequest('Lô hàng không đúng nguyên liệu');
      const avail = D(lot.qty_remaining.toString());
      if (avail.lt(line.qtyD))
        shortages.push({ ingredientId: line.ingredientId, missing: line.qtyD.sub(avail).toString() });
      planned.push({
        line,
        allocs: [
          { lotId: lot.id, qty: Decimal.min(avail, line.qtyD), unitPrice: D(lot.unit_price.toString()) },
        ],
        short: ZERO,
        pendingPrice: null,
      });
      continue;
    }
    const lots = await lockOpenLots(tx, a.branchId, line.ingredientId, a.allowPending ? undefined : a.date);
    const r = allocateFifo(
      lots.map((l) => ({
        id: l.id,
        qtyRemaining: l.qtyRemaining.toString(),
        unitPrice: l.unitPrice.toString(),
      })),
      line.qtyD,
    );
    if (r.shortQty.gt(0) && !a.allowPending)
      shortages.push({ ingredientId: line.ingredientId, missing: r.shortQty.toString() });
    const pendingPrice = r.shortQty.gt(0)
      ? ((await lastUnitPrice(tx, a.branchId, line.ingredientId, a.date)) ?? ZERO)
      : null;
    planned.push({ line, allocs: r.allocations, short: r.shortQty, pendingPrice });
  }

  if (shortages.length) {
    const names = await tx.ingredient.findMany({
      where: { id: { in: shortages.map((s) => s.ingredientId) } },
    });
    const detail = shortages.map((s) => {
      const ing = names.find((n) => n.id === s.ingredientId);
      return {
        ingredientId: s.ingredientId,
        name: ing?.name ?? '',
        unit: ing?.unit ?? '',
        missing: s.missing,
      };
    });
    throw badRequest(
      `Không đủ tồn kho: ${detail.map((d) => `${d.name} thiếu ${Number(d.missing)} ${d.unit}`).join(', ')}`,
      { shortages: detail },
    );
  }

  const issue = await tx.issue.create({
    data: {
      branchId: a.branchId,
      date: toDbDate(a.date),
      reason: a.reason,
      note: a.note ?? null,
      orderId: a.orderId ?? null,
      orderItemId: a.orderItemId ?? null,
      createdById: a.createdById,
    },
  });

  let total = ZERO;
  for (const p of planned) {
    const pendingCost = p.pendingPrice ? roundVnd(p.short.mul(p.pendingPrice)) : ZERO;
    const cost = allocationsCost(p.allocs).add(pendingCost);
    total = total.add(cost);
    await tx.issueItem.create({
      data: {
        issueId: issue.id,
        ingredientId: p.line.ingredientId,
        qty: p.line.qtyD.toString(),
        costTotal: cost.toString(),
        pendingQty: p.short.toString(),
        pendingUnitPrice: p.pendingPrice?.toString() ?? null,
        lotId: p.line.lotId ?? null,
        allocations: {
          create: p.allocs.map((x) => ({
            lotId: x.lotId,
            qty: x.qty.toString(),
            unitPrice: x.unitPrice.toString(),
          })),
        },
      },
    });
    for (const x of p.allocs) {
      await tx.lot.update({
        where: { id: x.lotId },
        data: { qtyRemaining: { decrement: x.qty.toString() } },
      });
    }
  }
  return { issueId: issue.id, costTotal: total };
}

/** Undo an issue: put every allocated quantity back into its lot, then delete the issue. */
export async function deleteIssueRestoringLots(tx: Tx, issueId: number): Promise<void> {
  const allocs = await tx.issueAllocation.findMany({ where: { issueItem: { issueId } } });
  for (const x of allocs.sort((p, q) => p.lotId - q.lotId)) {
    await tx.lot.update({ where: { id: x.lotId }, data: { qtyRemaining: { increment: x.qty } } });
  }
  await tx.issue.delete({ where: { id: issueId } });
}

/** Listeners told which issues changed cost after a "nợ kho" settlement (orders recompute their cost). */
type CostListener = (tx: Tx, issueIds: number[]) => Promise<void>;
const costListeners: CostListener[] = [];
export const onIssueCostsChanged = (fn: CostListener) => costListeners.push(fn);

/**
 * A new lot exists: cover outstanding "nợ kho" for its ingredient (oldest first), re-pricing those
 * issue lines from the provisional price to the real lot price.
 */
export async function settlePendingWithLot(tx: Tx, lotId: number): Promise<number[]> {
  const [lot] = await tx.$queryRaw<
    {
      id: number;
      branch_id: number;
      ingredient_id: number;
      qty_remaining: Prisma.Decimal;
      unit_price: Prisma.Decimal;
    }[]
  >`
    SELECT id, branch_id, ingredient_id, qty_remaining, unit_price FROM lots WHERE id = ${lotId} FOR UPDATE`;
  if (!lot) return [];
  const pending = await tx.issueItem.findMany({
    where: { ingredientId: lot.ingredient_id, pendingQty: { gt: 0 }, issue: { branchId: lot.branch_id } },
    include: { issue: true },
    orderBy: [{ issue: { date: 'asc' } }, { id: 'asc' }],
  });
  if (!pending.length) return [];

  const { settlements } = settlePending(
    lot.qty_remaining.toString(),
    pending.map((p) => ({ issueItemId: p.id, pendingQty: p.pendingQty.toString() })),
  );
  const changed = new Set<number>();
  for (const s of settlements) {
    const item = pending.find((p) => p.id === s.issueItemId)!;
    await tx.issueAllocation.create({
      data: { issueItemId: item.id, lotId: lot.id, qty: s.qty.toString(), unitPrice: lot.unit_price },
    });
    await tx.lot.update({ where: { id: lot.id }, data: { qtyRemaining: { decrement: s.qty.toString() } } });
    const pendingLeft = D(item.pendingQty.toString()).sub(s.qty);
    const allocs = await tx.issueAllocation.findMany({ where: { issueItemId: item.id } });
    const cost = allocationsCost(
      allocs.map((x) => ({ qty: x.qty.toString(), unitPrice: x.unitPrice.toString() })),
    ).add(roundVnd(pendingLeft.mul(item.pendingUnitPrice?.toString() ?? 0)));
    await tx.issueItem.update({
      where: { id: item.id },
      data: {
        pendingQty: pendingLeft.toString(),
        costTotal: cost.toString(),
        ...(pendingLeft.isZero() ? { pendingUnitPrice: null } : {}),
      },
    });
    changed.add(item.issueId);
  }
  const ids = [...changed];
  for (const fn of costListeners) await fn(tx, ids);
  return ids;
}

/** True when any part of the lot has been used (by issues, settlements or stocktakes). */
export async function lotsConsumed(tx: Tx, lotIds: number[]): Promise<boolean> {
  if (!lotIds.length) return false;
  const lots = await tx.lot.findMany({ where: { id: { in: lotIds } } });
  return lots.some((l) => !l.qtyRemaining.equals(l.qtyIn));
}

export const assertLotsUnused = async (tx: Tx, lotIds: number[]) => {
  if (await lotsConsumed(tx, lotIds)) {
    const allocs = await tx.issueAllocation.findMany({
      where: { lotId: { in: lotIds } },
      include: { issueItem: { include: { issue: true } } },
    });
    const issues = [...new Map(allocs.map((a) => [a.issueItem.issue.id, a.issueItem.issue])).values()];
    throw conflict(
      'LOT_USED',
      'Hàng của phiếu này đã được xuất / bán, không thể sửa hoặc xoá. Hãy xoá các phiếu xuất liên quan trước.',
      {
        issues: issues.map((i) => ({
          id: i.id,
          reason: i.reason,
          date: i.date.toISOString().slice(0, 10),
          orderId: i.orderId,
        })),
      },
    );
  }
};
