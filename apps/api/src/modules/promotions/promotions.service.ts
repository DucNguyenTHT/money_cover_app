// Automatic promotions (happy hour, combos). The order engine reads the active ones on every order change
// (orders.service → recompute); saving a promotion refreshes the open orders.
import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { prisma, inTx, type Db } from '../../core/db';
import { badRequest, notFound } from '../../core/errors';
import { writeAudit } from '../../core/audit';
import { defaultBranchId } from '../../core/branch';
import type { AuthUser } from '../../core/auth';
import type { PromotionDto, promotionInput } from '../../contracts/promotions.contract';
import { fromDbDate, toDbDate } from '../../domain/business-date';
import { D, ZERO, type Decimal } from '../../domain/money';
import { promoProblem, promoStatus, type PromoRule } from '../../domain/promotions/promotions';
import type { Channel } from '../../domain/enums';
import { businessToday } from '../settings/settings.service';

type Input = z.infer<typeof promotionInput>;

const include = {
  items: {
    include: { dish: { select: { name: true } }, category: { select: { name: true } } },
    orderBy: { id: 'asc' },
  },
} as const;
type Row = Prisma.PromotionGetPayload<{ include: typeof include }>;

const day = (d: Date | null) => (d ? fromDbDate(d) : null);

const toRule = (p: Prisma.PromotionGetPayload<{ include: { items: true } }>): PromoRule => ({
  id: p.id,
  kind: p.kind,
  startDate: day(p.startDate),
  endDate: day(p.endDate),
  weekdays: p.weekdays,
  startTime: p.startTime,
  endTime: p.endTime,
  channels: p.channels,
  percent: p.percent?.toString() ?? null,
  comboPrice: p.comboPrice?.toString() ?? null,
  items: p.items.map((i) => ({ dishId: i.dishId, categoryId: i.categoryId, qty: i.qty })),
});

/** Promotions switched on, for the order engine. */
export async function rules(db: Db, branchId: number): Promise<PromoRule[]> {
  const rows = await db.promotion.findMany({ where: { branchId, active: true }, include: { items: true } });
  return rows.map(toRule);
}

function toDto(
  p: Row,
  today: string,
  used: { orders: Set<number>; amount: Decimal } | undefined,
): PromotionDto {
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    active: p.active,
    startDate: day(p.startDate),
    endDate: day(p.endDate),
    weekdays: p.weekdays,
    startTime: p.startTime,
    endTime: p.endTime,
    channels: p.channels,
    percent: p.percent?.toString() ?? null,
    comboPrice: p.comboPrice?.toString() ?? null,
    items: p.items.map((i) => ({
      dishId: i.dishId,
      categoryId: i.categoryId,
      qty: i.qty,
      name: i.dish?.name ?? i.category?.name ?? '(đã xoá)',
    })),
    status: promoStatus({ active: p.active, startDate: day(p.startDate), endDate: day(p.endDate) }, today),
    monthOrders: used?.orders.size ?? 0,
    monthAmount: used?.amount.toString() ?? '0',
  };
}

export async function list(): Promise<PromotionDto[]> {
  const branchId = await defaultBranchId();
  const today = await businessToday(prisma);
  const rows = await prisma.promotion.findMany({
    where: { branchId },
    include,
    orderBy: [{ active: 'desc' }, { id: 'desc' }],
  });
  // Use this month: lines of paid orders that got a promotion.
  const lines = await prisma.orderItem.findMany({
    where: {
      promotionId: { not: null },
      status: 'ACTIVE',
      order: { branchId, status: 'PAID', businessDate: { gte: toDbDate(`${today.slice(0, 7)}-01`) } },
    },
    select: { orderId: true, promotionId: true, promoDiscount: true },
  });
  const used = new Map<number, { orders: Set<number>; amount: Decimal }>();
  for (const l of lines) {
    const u = used.get(l.promotionId!) ?? { orders: new Set<number>(), amount: ZERO };
    u.orders.add(l.orderId);
    u.amount = u.amount.add(l.promoDiscount.toString());
    used.set(l.promotionId!, u);
  }
  return rows.map((p) => toDto(p, today, used.get(p.id)));
}

async function checked(db: Db, b: Input) {
  // Happy hour on the whole menu has no lines; a combo keeps dishes only.
  const items = b.items.map((i) =>
    b.kind === 'COMBO'
      ? { dishId: i.dishId, categoryId: null, qty: i.qty }
      : { dishId: i.dishId, categoryId: i.dishId == null ? i.categoryId : null, qty: 1 },
  );
  const problem = promoProblem({
    ...b,
    channels: [...new Set(b.channels)],
    weekdays: [...new Set(b.weekdays)],
    percent: b.kind === 'TIME' ? b.percent : null,
    comboPrice: b.kind === 'COMBO' ? b.comboPrice : null,
    items,
  });
  if (problem) throw badRequest(problem);
  const dishIds = items.flatMap((i) => (i.dishId == null ? [] : [i.dishId]));
  const categoryIds = items.flatMap((i) => (i.categoryId == null ? [] : [i.categoryId]));
  if ((await db.dish.count({ where: { id: { in: dishIds } } })) !== new Set(dishIds).size)
    throw badRequest('Món không tồn tại');
  if ((await db.dishCategory.count({ where: { id: { in: categoryIds } } })) !== new Set(categoryIds).size)
    throw badRequest('Nhóm món không tồn tại');
  return {
    data: {
      name: b.name,
      kind: b.kind,
      active: b.active,
      startDate: b.startDate ? toDbDate(b.startDate) : null,
      endDate: b.endDate ? toDbDate(b.endDate) : null,
      weekdays: [...new Set(b.weekdays)].sort(),
      startTime: b.startTime,
      endTime: b.endTime,
      channels: [...new Set(b.channels)] as Channel[],
      percent: b.kind === 'TIME' ? D(b.percent!).toString() : null,
      comboPrice: b.kind === 'COMBO' ? D(b.comboPrice!).round().toString() : null,
    },
    items,
  };
}

async function one(id: number) {
  const today = await businessToday(prisma);
  const p = await prisma.promotion.findUniqueOrThrow({ where: { id }, include });
  return toDto(p, today, undefined);
}

export async function create(user: AuthUser, b: Input) {
  const id = await inTx(async (tx) => {
    const { data, items } = await checked(tx, b);
    const p = await tx.promotion.create({
      data: { ...data, branchId: await defaultBranchId(), items: { create: items } },
    });
    await writeAudit(tx, {
      entity: 'promotion',
      entityId: p.id,
      action: 'CREATE',
      after: b,
      userId: user.id,
    });
    return p.id;
  });
  return one(id);
}

export async function update(user: AuthUser, id: number, b: Input) {
  await inTx(async (tx) => {
    const before = await tx.promotion.findUnique({ where: { id }, include: { items: true } });
    if (!before) throw notFound('Không tìm thấy khuyến mãi');
    const { data, items } = await checked(tx, b);
    await tx.promotionItem.deleteMany({ where: { promotionId: id } });
    await tx.promotion.update({ where: { id }, data: { ...data, items: { create: items } } });
    await writeAudit(tx, {
      entity: 'promotion',
      entityId: id,
      action: 'UPDATE',
      before: toRule(before),
      after: b,
      userId: user.id,
    });
  });
  return one(id);
}

/** Only a promotion no paid order has used (open orders are worked out again); a used one is switched off instead (old bills keep its name). */
export async function remove(user: AuthUser, id: number) {
  await inTx(async (tx) => {
    const p = await tx.promotion.findUnique({ where: { id }, include: { items: true } });
    if (!p) throw notFound('Không tìm thấy khuyến mãi');
    if (await tx.orderItem.count({ where: { promotionId: id, order: { paidAt: { not: null } } } }))
      throw badRequest('Khuyến mãi đã dùng trong đơn — hãy tắt thay vì xoá');
    await tx.promotion.delete({ where: { id } });
    await writeAudit(tx, {
      entity: 'promotion',
      entityId: id,
      action: 'DELETE',
      before: toRule(p),
      userId: user.id,
    });
  });
}
