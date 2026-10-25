// Regular customers (khách quen) and their loyalty points. Points move only through point_entries (earned at
// payment, spent on an order, given back when a paid order is cancelled, adjusted by an ADMIN with a reason);
// customers.points is the running balance.
import type { Customer, Prisma } from '@prisma/client';
import { prisma, type Tx } from '../../core/db';
import { badRequest, conflict, notFound } from '../../core/errors';
import { writeAudit } from '../../core/audit';
import { defaultBranchId } from '../../core/branch';
import type { AuthUser } from '../../core/auth';
import type { CustomerDto, customerInput } from '../../contracts/customers.contract';
import type { z } from 'zod';
import { fromDbDate, toDbDate } from '../../domain/business-date';
import { compactText } from '../../domain/bank/match';
import { normalizePhone } from '../../domain/loyalty/points';
import type { PointKind } from '../../domain/enums';

export const toDto = (c: Customer): CustomerDto => ({
  id: c.id,
  phone: c.phone,
  name: c.name,
  birthday: c.birthday ? fromDbDate(c.birthday) : null,
  note: c.note,
  points: c.points,
  visits: c.visits,
  totalSpent: c.totalSpent.toString(),
  lastVisitAt: c.lastVisitAt?.toISOString() ?? null,
  active: c.active,
  createdAt: c.createdAt.toISOString(),
});

const phoneOf = (raw: string) => {
  const p = normalizePhone(raw);
  if (!p) throw badRequest('Số điện thoại không hợp lệ');
  return p;
};

export async function list(q: { q?: string; sort: 'RECENT' | 'SPENT' | 'POINTS' | 'NAME'; limit: number }) {
  const term = q.q?.trim() ?? '';
  const digits = term.replace(/\D/g, '');
  const orderBy: Prisma.CustomerOrderByWithRelationInput[] =
    q.sort === 'SPENT'
      ? [{ totalSpent: 'desc' }]
      : q.sort === 'POINTS'
        ? [{ points: 'desc' }]
        : q.sort === 'NAME'
          ? [{ name: 'asc' }]
          : [{ lastVisitAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }];
  const rows = await prisma.customer.findMany({
    where: term
      ? {
          OR: [
            ...(digits.length >= 3 ? [{ phone: { contains: normalizePhone(digits) ?? digits } }] : []),
            { name: { contains: term, mode: 'insensitive' as const } },
          ],
        }
      : {},
    orderBy,
    take: term ? Math.max(q.limit, 50) : q.limit,
  });
  // Names typed without accents still find "Nguyễn" (compared on letters only).
  const plain = compactText(term);
  const extra =
    term && !digits && plain.length >= 2 && rows.length < 20
      ? (await prisma.customer.findMany({ take: 2000, orderBy })).filter(
          (c) => compactText(c.name).includes(plain) && !rows.some((r) => r.id === c.id),
        )
      : [];
  return [...rows, ...extra].slice(0, q.limit).map(toDto);
}

export async function get(id: number) {
  const c = await prisma.customer.findUnique({ where: { id } });
  if (!c) throw notFound('Khách hàng');
  const [entries, orders] = await Promise.all([
    prisma.pointEntry.findMany({ where: { customerId: id }, orderBy: { id: 'desc' }, take: 200 }),
    prisma.order.findMany({
      where: { customerId: id },
      orderBy: { openedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        code: true,
        businessDate: true,
        status: true,
        total: true,
        pointsEarned: true,
        pointsRedeemed: true,
      },
    }),
  ]);
  const codes = new Map(
    (
      await prisma.order.findMany({
        where: { id: { in: entries.flatMap((e) => (e.orderId ? [e.orderId] : [])) } },
        select: { id: true, code: true },
      })
    ).map((o) => [o.id, o.code]),
  );
  const users = new Map(
    (
      await prisma.user.findMany({
        where: { id: { in: entries.flatMap((e) => (e.createdById ? [e.createdById] : [])) } },
        select: { id: true, fullName: true },
      })
    ).map((u) => [u.id, u.fullName]),
  );
  return {
    customer: toDto(c),
    entries: entries.map((e) => ({
      id: e.id,
      kind: e.kind,
      points: e.points,
      orderId: e.orderId,
      orderCode: e.orderId ? (codes.get(e.orderId) ?? null) : null,
      note: e.note,
      createdByName: e.createdById ? (users.get(e.createdById) ?? null) : null,
      createdAt: e.createdAt.toISOString(),
    })),
    orders: orders.map((o) => ({
      id: o.id,
      code: o.code,
      businessDate: fromDbDate(o.businessDate),
      status: o.status,
      total: o.total.toString(),
      pointsEarned: o.pointsEarned,
      pointsRedeemed: o.pointsRedeemed,
    })),
  };
}

async function assertPhoneFree(phone: string, exceptId?: number) {
  const other = await prisma.customer.findUnique({ where: { phone } });
  if (other && other.id !== exceptId)
    throw conflict('DUPLICATE', `Số ${phone} đã có: ${other.name}`, { id: other.id });
}

export async function create(user: AuthUser, input: z.infer<typeof customerInput>) {
  const phone = phoneOf(input.phone);
  await assertPhoneFree(phone);
  const c = await prisma.customer.create({
    data: {
      branchId: await defaultBranchId(),
      phone,
      name: input.name.trim(),
      birthday: input.birthday ? toDbDate(input.birthday) : null,
      note: input.note?.trim() || null,
    },
  });
  await writeAudit(prisma, {
    entity: 'customer',
    entityId: c.id,
    action: 'CREATE',
    after: { phone, name: c.name },
    userId: user.id,
  });
  return toDto(c);
}

export async function update(
  user: AuthUser,
  id: number,
  input: z.infer<typeof customerInput> & { active?: boolean },
) {
  const before = await prisma.customer.findUnique({ where: { id } });
  if (!before) throw notFound('Khách hàng');
  const phone = phoneOf(input.phone);
  await assertPhoneFree(phone, id);
  const c = await prisma.customer.update({
    where: { id },
    data: {
      phone,
      name: input.name.trim(),
      birthday: input.birthday ? toDbDate(input.birthday) : null,
      note: input.note?.trim() || null,
      ...(input.active !== undefined ? { active: input.active } : {}),
    },
  });
  await writeAudit(prisma, {
    entity: 'customer',
    entityId: id,
    action: 'UPDATE',
    before: { phone: before.phone, name: before.name },
    after: { phone, name: c.name },
    userId: user.id,
  });
  return toDto(c);
}

/** Move points (inside the caller's transaction): one ledger row + the balance. */
export async function addPointsTx(
  tx: Tx,
  customerId: number,
  kind: PointKind,
  points: number,
  opts: { orderId?: number | null; note?: string | null; userId?: number | null },
) {
  if (points === 0) return;
  await tx.pointEntry.create({
    data: {
      customerId,
      kind,
      points,
      orderId: opts.orderId ?? null,
      note: opts.note ?? null,
      createdById: opts.userId ?? null,
    },
  });
  await tx.customer.update({ where: { id: customerId }, data: { points: { increment: points } } });
}

/** Lock a customer row and read their balance (spending points at payment). */
export async function lockBalance(tx: Tx, customerId: number) {
  await tx.$queryRaw`SELECT id FROM customers WHERE id = ${customerId} FOR UPDATE`;
  return (await tx.customer.findUniqueOrThrow({ where: { id: customerId } })).points;
}

export async function adjustPoints(user: AuthUser, id: number, points: number, reason: string) {
  const c = await prisma.customer.findUnique({ where: { id } });
  if (!c) throw notFound('Khách hàng');
  if (c.points + points < 0) throw badRequest(`Khách chỉ có ${c.points} điểm`);
  await prisma.$transaction(async (tx) => {
    await addPointsTx(tx, id, 'ADJUST', points, { note: reason, userId: user.id });
    await writeAudit(tx, {
      entity: 'customer',
      entityId: id,
      action: 'ADJUST_POINTS',
      reason,
      after: { points },
      userId: user.id,
    });
  });
  return toDto(await prisma.customer.findUniqueOrThrow({ where: { id } }));
}
