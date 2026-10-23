import type { Prisma } from '@prisma/client';
import { prisma, inTx, type Db, type Tx } from '../../core/db';
import { badRequest, conflict, notFound } from '../../core/errors';
import { writeAudit } from '../../core/audit';
import { assertPeriodOpen } from '../../core/period-lock';
import { defaultBranchId } from '../../core/branch';
import type { AuthUser } from '../../core/auth';
import type { StocktakeDetail, StocktakeSummary } from '../../contracts/stocktake.contract';
import { fromDbDate, toDbDate } from '../../domain/business-date';
import { D, Decimal, ZERO, roundVnd } from '../../domain/money';
import { allocateFifo, allocationsCost } from '../../domain/inventory/fifo';
import { allocateLoss, variance } from '../../domain/stocktake/stocktake';
import {
  assertLotsUnused,
  lastUnitPrice,
  lockOpenLots,
  settlePendingWithLot,
} from '../inventory/stock-engine';

const include = {
  items: {
    include: { ingredient: true, dishAllocations: { include: { dish: true } } },
    orderBy: { ingredient: { code: 'asc' } },
  },
} as const;
type Row = Prisma.StocktakeGetPayload<{ include: typeof include }>;

/**
 * Book quantity of every ingredient at the end of `date`:
 * everything that came in (lots dated ≤ date: purchases, opening, stocktake surpluses)
 * − everything issued on/before date (sales, disposals, returns, internal use — pending included)
 * − shortages of stocktakes completed on/before date.
 */
async function bookAt(
  db: Db,
  branchId: number,
  date: string,
  excludeStocktakeId?: number,
): Promise<Map<number, Decimal>> {
  const d = toDbDate(date);
  const rows = await db.$queryRaw<{ ingredient_id: number; qty: Prisma.Decimal }[]>`
    SELECT i.id AS ingredient_id,
      COALESCE((SELECT SUM(l.qty_in) FROM lots l WHERE l.ingredient_id = i.id AND l.branch_id = ${branchId} AND l.date <= ${d}::date), 0)
      - COALESCE((SELECT SUM(ii.qty) FROM issue_items ii JOIN issues s ON s.id = ii.issue_id
                  WHERE ii.ingredient_id = i.id AND s.branch_id = ${branchId} AND s.date <= ${d}::date), 0)
      - COALESCE((SELECT SUM(sa.qty) FROM stocktake_allocations sa
                  JOIN stocktake_items si ON si.id = sa.stocktake_item_id
                  JOIN stocktakes st ON st.id = si.stocktake_id
                  WHERE si.ingredient_id = i.id AND st.branch_id = ${branchId} AND st.status = 'DONE'
                    AND st.date <= ${d}::date AND st.id <> ${excludeStocktakeId ?? 0}), 0) AS qty
    FROM ingredients i`;
  return new Map(rows.map((r) => [r.ingredient_id, D(r.qty.toString())]));
}

async function pendingNow(db: Db, branchId: number) {
  const rows = await db.issueItem.groupBy({
    by: ['ingredientId'],
    where: { pendingQty: { gt: 0 }, issue: { branchId } },
    _sum: { pendingQty: true },
  });
  return new Map(rows.map((r) => [r.ingredientId, r._sum.pendingQty?.toString() ?? '0']));
}

/**
 * Start of the allocation period — sales AFTER this business date count: the previous completed stocktake (counted at
 * the end of its day), else the day before the opening stock (it is the stock at the start of that day, so that day's
 * sales count), else nothing.
 */
async function periodStart(db: Db, branchId: number, date: string, selfId: number): Promise<string | null> {
  const prev = await db.stocktake.findFirst({
    where: { branchId, status: 'DONE', id: { not: selfId }, date: { lt: toDbDate(date) } },
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
  });
  if (prev) return fromDbDate(prev.date);
  const opening = await db.receipt.findFirst({
    where: { branchId, kind: 'OPENING' },
    orderBy: { date: 'asc' },
  });
  return opening ? fromDbDate(new Date(opening.date.getTime() - 86_400_000)) : null;
}

/**
 * How much of one ingredient each dish used in PAID orders of (from, to]: recipe × size factor (ingredient lines
 * only, packaging stays one per portion) + extra ingredients of the options chosen (order_item_extras).
 */
async function usageByDish(db: Db, branchId: number, ingredientId: number, from: string | null, to: string) {
  const rows = await db.$queryRaw<{ dish_id: number; qty: Prisma.Decimal }[]>`
    SELECT dish_id, SUM(qty) AS qty FROM (
      SELECT oi.dish_id,
             oi.qty * ri.qty * (CASE WHEN ri.scope = 'ALL' THEN oi.recipe_factor ELSE 1 END) AS qty
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN dish_recipe_items ri ON ri.recipe_id = oi.recipe_id
      WHERE o.branch_id = ${branchId} AND o.status = 'PAID' AND oi.status = 'ACTIVE'
        AND ri.ingredient_id = ${ingredientId}
        AND (ri.scope = 'ALL' OR o.channel <> 'DINE_IN')
        AND o.business_date <= ${toDbDate(to)}::date
        AND (${from}::date IS NULL OR o.business_date > ${from}::date)
      UNION ALL
      SELECT oi.dish_id, oi.qty * ex.qty AS qty
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN order_item_extras ex ON ex.order_item_id = oi.id
      WHERE o.branch_id = ${branchId} AND o.status = 'PAID' AND oi.status = 'ACTIVE'
        AND ex.ingredient_id = ${ingredientId}
        AND o.business_date <= ${toDbDate(to)}::date
        AND (${from}::date IS NULL OR o.business_date > ${from}::date)
    ) u
    GROUP BY dish_id`;
  return rows.map((r) => ({ dishId: r.dish_id, qty: r.qty.toString() }));
}

async function names(db: Db, ids: number[]) {
  const rows = await db.user.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, fullName: true },
  });
  return new Map(rows.map((u) => [u.id, u.fullName]));
}

function summary(s: Row, who: Map<number, string>): StocktakeSummary {
  return {
    id: s.id,
    date: fromDbDate(s.date),
    status: s.status,
    note: s.note,
    itemCount: s.items.length,
    countedCount: s.items.filter((i) => i.actualQty !== null).length,
    lossTotal: s.items.reduce((sum, i) => sum.add(i.lossValue.toString()), ZERO).toString(),
    createdByName: who.get(s.createdById) ?? '',
    completedAt: s.completedAt?.toISOString() ?? null,
  };
}

async function detail(id: number, db: Db = prisma): Promise<StocktakeDetail> {
  const s = await db.stocktake.findUnique({ where: { id }, include });
  if (!s) throw notFound('Phiếu kiểm kê');
  const [who, pending] = await Promise.all([names(db, [s.createdById]), pendingNow(db, s.branchId)]);
  const byDish = new Map<string, { dishId: number | null; dishName: string; value: Decimal }>();
  for (const it of s.items) {
    for (const a of it.dishAllocations) {
      const key = String(a.dishId);
      const cur = byDish.get(key) ?? {
        dishId: a.dishId,
        dishName: a.dish?.name ?? 'Hao hụt chung',
        value: ZERO,
      };
      cur.value = cur.value.add(a.value.toString());
      byDish.set(key, cur);
    }
  }
  return {
    ...summary(s, who),
    periodFrom: await periodStart(db, s.branchId, fromDbDate(s.date), s.id),
    items: s.items.map((i) => ({
      ingredientId: i.ingredientId,
      code: i.ingredient.code,
      name: i.ingredient.name,
      unit: i.ingredient.unit,
      category: i.ingredient.category,
      bookQty: i.bookQty.toString(),
      actualQty: i.actualQty?.toString() ?? null,
      diffQty:
        i.diffQty?.toString() ??
        (i.actualQty !== null ? D(i.actualQty.toString()).sub(i.bookQty.toString()).toString() : null),
      pendingQty: pending.get(i.ingredientId) ?? '0',
      lossValue: i.lossValue.toString(),
    })),
    dishAllocations: [...byDish.values()]
      .sort((a, b) => b.value.cmp(a.value))
      .map((a) => ({ dishId: a.dishId, dishName: a.dishName, lossValue: a.value.toString() })),
  };
}

export { detail as get };

export async function list(month?: string) {
  const where: Prisma.StocktakeWhereInput = { branchId: await defaultBranchId() };
  if (month) {
    const [y, m] = month.split('-').map(Number) as [number, number];
    where.date = { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
  }
  const rows = await prisma.stocktake.findMany({
    where,
    include,
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
  });
  const who = await names(
    prisma,
    rows.map((r) => r.createdById),
  );
  return rows.map((r) => summary(r, who));
}

export async function create(user: AuthUser, date: string, note: string | null) {
  const branchId = await defaultBranchId();
  const id = await inTx(async (tx) => {
    await assertPeriodOpen(tx, date);
    const draft = await tx.stocktake.findFirst({ where: { branchId, status: 'DRAFT' } });
    if (draft)
      throw conflict(
        'DRAFT_EXISTS',
        `Đang có phiếu kiểm kê nháp ngày ${fromDbDate(draft.date).split('-').reverse().join('/')} — hoàn tất hoặc huỷ phiếu đó trước`,
      );
    const book = await bookAt(tx, branchId, date);
    const ingredients = await tx.ingredient.findMany({ where: { active: true } });
    const s = await tx.stocktake.create({
      data: {
        branchId,
        date: toDbDate(date),
        note,
        createdById: user.id,
        items: {
          create: ingredients.map((i) => ({
            ingredientId: i.id,
            bookQty: (book.get(i.id) ?? ZERO).toString(),
          })),
        },
      },
    });
    await writeAudit(tx, {
      entity: 'stocktake',
      entityId: s.id,
      action: 'CREATE',
      after: { date, note },
      userId: user.id,
    });
    return s.id;
  });
  return detail(id);
}

async function loadDraft(tx: Tx, id: number) {
  const s = await tx.stocktake.findUnique({ where: { id } });
  if (!s) throw notFound('Phiếu kiểm kê');
  if (s.status !== 'DRAFT') throw conflict('STOCKTAKE_CLOSED', 'Phiếu kiểm kê đã chốt hoặc đã huỷ');
  return s;
}

export async function update(
  user: AuthUser,
  id: number,
  input: { note: string | null; items: { ingredientId: number; actualQty: string | null }[] },
) {
  await inTx(async (tx) => {
    await loadDraft(tx, id);
    await tx.stocktake.update({ where: { id }, data: { note: input.note } });
    for (const it of input.items) {
      await tx.stocktakeItem.updateMany({
        where: { stocktakeId: id, ingredientId: it.ingredientId },
        data: { actualQty: it.actualQty },
      });
    }
  });
  return detail(id);
}

export async function complete(user: AuthUser, id: number) {
  await inTx(async (tx) => {
    await tx.$queryRaw`SELECT id FROM stocktakes WHERE id = ${id} FOR UPDATE`;
    const s = await loadDraft(tx, id);
    const date = fromDbDate(s.date);
    await assertPeriodOpen(tx, date);
    const items = await tx.stocktakeItem.findMany({
      where: { stocktakeId: id },
      orderBy: { ingredientId: 'asc' },
    });
    const counted = items.filter((i) => i.actualQty !== null);
    if (!counted.length) throw badRequest('Chưa nhập tồn thực tế của nguyên liệu nào');
    // Recount the book now: sales may have happened since the draft was opened.
    const book = await bookAt(tx, s.branchId, date, id);
    const from = await periodStart(tx, s.branchId, date, id);

    for (const it of items) {
      const bookQty = book.get(it.ingredientId) ?? ZERO;
      if (it.actualQty === null) {
        await tx.stocktakeItem.update({ where: { id: it.id }, data: { bookQty: bookQty.toString() } });
        continue;
      }
      const v = variance(bookQty, it.actualQty.toString());
      let loss = ZERO;
      if (v.shortage.gt(0)) {
        const lots = await lockOpenLots(tx, s.branchId, it.ingredientId, date);
        const r = allocateFifo(
          lots.map((l) => ({
            id: l.id,
            qtyRemaining: l.qtyRemaining.toString(),
            unitPrice: l.unitPrice.toString(),
          })),
          v.shortage,
        );
        for (const a of r.allocations) {
          await tx.stocktakeAllocation.create({
            data: {
              stocktakeItemId: it.id,
              lotId: a.lotId,
              qty: a.qty.toString(),
              unitPrice: a.unitPrice.toString(),
            },
          });
          await tx.lot.update({
            where: { id: a.lotId },
            data: { qtyRemaining: { decrement: a.qty.toString() } },
          });
        }
        // Lots can hold less than the book says when sales ran into "nợ kho": value the rest at the last price.
        const rest = r.shortQty.gt(0)
          ? roundVnd(r.shortQty.mul((await lastUnitPrice(tx, s.branchId, it.ingredientId, date)) ?? ZERO))
          : ZERO;
        loss = allocationsCost(r.allocations).add(rest);
      } else if (v.surplus.gt(0)) {
        const price = (await lastUnitPrice(tx, s.branchId, it.ingredientId, date)) ?? ZERO;
        const lot = await tx.lot.create({
          data: {
            branchId: s.branchId,
            ingredientId: it.ingredientId,
            date: s.date,
            unitPrice: price.toString(),
            qtyIn: v.surplus.toString(),
            qtyRemaining: v.surplus.toString(),
            stocktakeItemId: it.id,
          },
        });
        await tx.stocktakeItem.update({ where: { id: it.id }, data: { surplusUnitPrice: price.toString() } });
        await settlePendingWithLot(tx, lot.id);
        loss = roundVnd(v.surplus.mul(price)).neg();
      }
      await tx.stocktakeItem.update({
        where: { id: it.id },
        data: { bookQty: bookQty.toString(), diffQty: v.diff.toString(), lossValue: loss.toString() },
      });
      if (!loss.isZero()) {
        const usage = await usageByDish(tx, s.branchId, it.ingredientId, from, date);
        for (const a of allocateLoss(loss, usage)) {
          await tx.stocktakeDishAllocation.create({
            data: {
              stocktakeItemId: it.id,
              dishId: a.dishId,
              usageQty: a.usageQty.toString(),
              value: a.value.toString(),
            },
          });
        }
      }
    }
    await tx.stocktake.update({
      where: { id },
      data: { status: 'DONE', completedById: user.id, completedAt: new Date() },
    });
    await writeAudit(tx, { entity: 'stocktake', entityId: id, action: 'COMPLETE', userId: user.id });
  });
  return detail(id);
}

export async function cancel(user: AuthUser, id: number, reason: string) {
  await inTx(async (tx) => {
    await tx.$queryRaw`SELECT id FROM stocktakes WHERE id = ${id} FOR UPDATE`;
    const s = await tx.stocktake.findUnique({
      where: { id },
      include: { items: { include: { allocations: true, surplusLots: true } } },
    });
    if (!s) throw notFound('Phiếu kiểm kê');
    if (s.status === 'CANCELLED') throw conflict('STOCKTAKE_CLOSED', 'Phiếu đã huỷ');
    await assertPeriodOpen(tx, fromDbDate(s.date));
    if (s.status === 'DONE') {
      const surplusLots = s.items.flatMap((i) => i.surplusLots.map((l) => l.id));
      await assertLotsUnused(tx, surplusLots);
      for (const a of s.items.flatMap((i) => i.allocations).sort((x, y) => x.lotId - y.lotId)) {
        await tx.lot.update({ where: { id: a.lotId }, data: { qtyRemaining: { increment: a.qty } } });
      }
      const itemIds = s.items.map((i) => i.id);
      await tx.stocktakeAllocation.deleteMany({ where: { stocktakeItemId: { in: itemIds } } });
      await tx.stocktakeDishAllocation.deleteMany({ where: { stocktakeItemId: { in: itemIds } } });
      await tx.lot.deleteMany({ where: { id: { in: surplusLots } } });
      await tx.stocktakeItem.updateMany({
        where: { stocktakeId: id },
        data: { lossValue: 0, diffQty: null },
      });
    }
    await tx.stocktake.update({ where: { id }, data: { status: 'CANCELLED' } });
    await writeAudit(tx, {
      entity: 'stocktake',
      entityId: id,
      action: 'CANCEL',
      reason,
      before: { status: s.status },
      userId: user.id,
    });
  });
  return detail(id);
}
