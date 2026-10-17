import type { Prisma } from '@prisma/client';
import { prisma } from '../../core/db';
import { badRequest, forbidden, notFound } from '../../core/errors';
import { emit } from '../../core/realtime';
import type { AuthUser } from '../../core/auth';
import { socketRooms } from '../../contracts/socket-events';
import type { KitchenItem } from '../../contracts/orders.contract';
import type { Station } from '../../domain/enums';
import { whereOf } from './print';

const include = { dish: true, order: { include: { table: true, deliveryApp: true } } } as const;
type Row = Prisma.OrderItemGetPayload<{ include: typeof include }>;

const toItem = (i: Row): KitchenItem => ({
  itemId: i.id,
  orderId: i.orderId,
  orderCode: i.order.code,
  where: whereOf({
    channel: i.order.channel,
    tableName: i.order.table?.name ?? null,
    deliveryAppName: i.order.deliveryApp?.name ?? null,
    appOrderCode: i.order.appOrderCode,
    code: i.order.code,
  }),
  dishName: i.dish.name,
  qty: i.qty,
  note: i.note,
  kitchenStatus: i.kitchenStatus,
  sentAt: (i.sentAt ?? new Date()).toISOString(),
  doneAt: i.doneAt?.toISOString() ?? null,
});

/** Kitchen accounts only see their own station; staff and admins may watch any. */
function assertStation(user: AuthUser, station: Station) {
  if (user.role === 'KITCHEN' && user.station !== station)
    throw forbidden('Tài khoản này chỉ xem được trạm của mình');
}

export async function queue(user: AuthUser, station: Station) {
  assertStation(user, station);
  const since = new Date(Date.now() - 24 * 3600_000);
  const rows = await prisma.orderItem.findMany({
    where: {
      station,
      status: 'ACTIVE',
      kitchenStatus: { in: ['SENT', 'DONE'] },
      sentAt: { gte: since },
      order: { status: { not: 'CANCELLED' } },
    },
    include,
    orderBy: [{ sentAt: 'asc' }, { id: 'asc' }],
  });
  return rows.map(toItem);
}

export async function setStatus(user: AuthUser, itemId: number, status: 'SENT' | 'DONE' | 'SERVED') {
  const it = await prisma.orderItem.findUnique({ where: { id: itemId } });
  if (!it || it.status !== 'ACTIVE') throw notFound('Món');
  assertStation(user, it.station);
  if (it.kitchenStatus === 'NEW') throw badRequest('Món chưa được gửi bếp');
  const now = new Date();
  const row = await prisma.orderItem.update({
    where: { id: itemId },
    data: {
      kitchenStatus: status,
      doneAt: status === 'SENT' ? null : (it.doneAt ?? now),
      servedAt: status === 'SERVED' ? now : null,
    },
    include,
  });
  emit(socketRooms.kitchen(it.station), 'kitchen:update', { station: it.station, itemIds: [itemId] });
  emit(socketRooms.pos, 'order:update', { orderId: it.orderId });
  return toItem(row);
}

export async function doneAll(user: AuthUser, station: Station) {
  assertStation(user, station);
  const rows = await prisma.orderItem.findMany({
    where: { station, status: 'ACTIVE', kitchenStatus: 'SENT' },
    select: { id: true, orderId: true },
  });
  if (!rows.length) return { count: 0 };
  await prisma.orderItem.updateMany({
    where: { id: { in: rows.map((r) => r.id) } },
    data: { kitchenStatus: 'DONE', doneAt: new Date() },
  });
  emit(socketRooms.kitchen(station), 'kitchen:update', { station, itemIds: rows.map((r) => r.id) });
  for (const orderId of new Set(rows.map((r) => r.orderId)))
    emit(socketRooms.pos, 'order:update', { orderId });
  return { count: rows.length };
}
