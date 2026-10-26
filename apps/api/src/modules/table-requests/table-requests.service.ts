// Ordering from the QR on the table. Guests (no login, public routes with their own rate limit) see the menu and
// send requests; nothing reaches an order until staff accept it on a till.
import { randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { prisma } from '../../core/db';
import { badRequest, conflict, notFound } from '../../core/errors';
import { writeAudit } from '../../core/audit';
import { defaultBranchId } from '../../core/branch';
import { emit } from '../../core/realtime';
import type { AuthUser } from '../../core/auth';
import { socketRooms } from '../../contracts/socket-events';
import type {
  GuestMenu,
  GuestRequest,
  guestContract,
  TableRequestDto,
} from '../../contracts/table-requests.contract';
import { D } from '../../domain/money';
import { resolveOptions, type OptionGroupDef } from '../../domain/menu/options';
import {
  mergeLines,
  QR_LIMITS,
  requestProblem,
  requestTitle,
  type RequestLine,
} from '../../domain/qr/table-requests';
import { listDishes } from '../menu/menu.service';
import { groupsForDishes } from '../menu/options.service';
import { getSettings } from '../settings/settings.service';
import * as orders from '../orders/orders.service';

type SendBody = z.infer<(typeof guestContract)['send']['body']>;

const newToken = () => randomBytes(12).toString('base64url');
const staleSince = () => new Date(Date.now() - QR_LIMITS.staleMinutes * 60_000);

/** The table of a QR; 404 when QR ordering is off or the code was renewed. */
async function tableOf(token: string) {
  const s = await getSettings();
  if (!s.qr_order_enabled) throw notFound('Quán chưa bật gọi món bằng mã QR — gọi nhân viên giúp bạn nhé');
  const t = await prisma.diningTable.findUnique({ where: { qrToken: token }, include: { area: true } });
  if (!t || !t.active) throw notFound('Mã QR này không còn dùng được — gọi nhân viên giúp bạn nhé');
  return t;
}

/** Dishes on sale at the in-store price, with their active option groups. */
async function sellable() {
  const dishes = (await listDishes()).filter((d) => d.active && d.storePrice !== null);
  const groups = await groupsForDishes(
    prisma,
    dishes.map((d) => d.id),
  );
  const active = (id: number) => (groups.get(id) ?? []).filter((g) => g.active);
  return { dishes, active };
}

export async function menu(token: string): Promise<GuestMenu> {
  const t = await tableOf(token);
  const branch = await prisma.branch.findUniqueOrThrow({ where: { id: await defaultBranchId() } });
  const { dishes, active } = await sellable();
  const used = new Map<number, OptionGroupDef>();
  for (const d of dishes) for (const g of active(d.id)) used.set(g.id, g);
  const categories = await prisma.dishCategory.findMany({
    where: { id: { in: [...new Set(dishes.map((d) => d.categoryId))] } },
    orderBy: [{ sort: 'asc' }, { name: 'asc' }],
  });
  return {
    shopName: branch.name,
    tableName: t.name,
    areaName: t.area.name,
    categories: categories.map((c) => ({ id: c.id, name: c.name })),
    dishes: dishes.map((d) => ({
      id: d.id,
      name: d.name,
      categoryId: d.categoryId,
      price: d.storePrice!,
      soldOut: d.soldOut,
      groupIds: active(d.id).map((g) => g.id),
    })),
    groups: [...used.values()].map((g) => ({
      id: g.id,
      name: g.name,
      multi: g.multi,
      required: g.required,
      maxSelect: g.maxSelect,
      options: g.options
        .filter((o) => o.active)
        .map((o) => ({ id: o.id, name: o.name, price: D(o.price).toString(), isDefault: o.isDefault })),
    })),
  };
}

const portions = (items: Prisma.JsonValue | null) =>
  ((items as RequestLine[] | null) ?? []).reduce((s, i) => s + i.qty, 0);

const toGuest = (r: {
  id: number;
  kind: GuestRequest['kind'];
  status: GuestRequest['status'];
  items: Prisma.JsonValue | null;
  rejectReason: string | null;
  createdAt: Date;
}): GuestRequest => ({
  id: r.id,
  kind: r.kind,
  status: r.status,
  portions: portions(r.items),
  rejectReason: r.rejectReason,
  createdAt: r.createdAt.toISOString(),
});

export async function send(token: string, b: SendBody, ip: string | null): Promise<GuestRequest> {
  const t = await tableOf(token);
  const items = b.kind === 'ORDER' ? mergeLines(b.items) : b.items;
  const problem = requestProblem(b.kind, items);
  if (problem) throw badRequest(problem);
  if (items.length) {
    // Options are what the guest ticked (the page starts from the defaults), checked like on the till.
    const { dishes, active } = await sellable();
    for (const i of items) {
      const d = dishes.find((x) => x.id === i.dishId);
      if (!d) throw badRequest('Có món không còn bán — tải lại thực đơn');
      if (d.soldOut) throw badRequest(`${d.name} đã hết`);
      const r = resolveOptions(active(d.id), i.optionIds);
      if ('error' in r) throw badRequest(`${d.name}: ${r.error}`);
    }
  }
  const waiting = { tableId: t.id, status: 'PENDING' as const, createdAt: { gte: staleSince() } };
  // Calling staff twice while they are on their way is the same request.
  if (b.kind !== 'ORDER') {
    const same = await prisma.tableRequest.findFirst({ where: { ...waiting, kind: b.kind } });
    if (same) return toGuest(same);
  }
  if ((await prisma.tableRequest.count({ where: waiting })) >= QR_LIMITS.pendingPerTable)
    throw conflict('TOO_MANY_REQUESTS', 'Bàn đang có nhiều yêu cầu chờ — nhân viên sẽ tới ngay');
  if (
    (await prisma.tableRequest.count({ where: { ...waiting, clientId: b.clientId } })) >=
    QR_LIMITS.pendingPerClient
  )
    throw conflict('TOO_MANY_REQUESTS', 'Bạn còn yêu cầu đang chờ quán xác nhận — đợi một chút nhé');
  const r = await prisma.tableRequest.create({
    data: {
      branchId: await defaultBranchId(),
      tableId: t.id,
      kind: b.kind,
      items: items.length ? (items as unknown as Prisma.InputJsonValue) : undefined,
      note: b.note || null,
      clientId: b.clientId,
      ip,
    },
  });
  emit(socketRooms.pos, 'table:request', {
    tableId: t.id,
    requestId: r.id,
    title: requestTitle(b.kind, t.name, items),
  });
  return toGuest(r);
}

/** The guest's own requests on this table today (newest first). */
export async function mine(token: string, clientId: string): Promise<GuestRequest[]> {
  const t = await tableOf(token);
  const rows = await prisma.tableRequest.findMany({
    where: { tableId: t.id, clientId, createdAt: { gte: new Date(Date.now() - 12 * 3600_000) } },
    orderBy: { id: 'desc' },
    take: 20,
  });
  return rows.map(toGuest);
}

// ---------------------------------------------------------------- staff

const include = { table: { select: { name: true } } } as const;
type Row = Prisma.TableRequestGetPayload<{ include: typeof include }>;

async function toDtos(rows: Row[]): Promise<TableRequestDto[]> {
  const lines = rows.flatMap((r) => (r.items as RequestLine[] | null) ?? []);
  const [dishes, options, users] = await Promise.all([
    prisma.dish.findMany({
      where: { id: { in: [...new Set(lines.map((l) => l.dishId))] } },
      select: { id: true, name: true },
    }),
    prisma.option.findMany({
      where: { id: { in: [...new Set(lines.flatMap((l) => l.optionIds))] } },
      select: { id: true, name: true },
    }),
    prisma.user.findMany({
      where: { id: { in: rows.flatMap((r) => (r.handledById ? [r.handledById] : [])) } },
      select: { id: true, fullName: true },
    }),
  ]);
  const dish = new Map(dishes.map((d) => [d.id, d.name]));
  const option = new Map(options.map((o) => [o.id, o.name]));
  const user = new Map(users.map((u) => [u.id, u.fullName]));
  return rows.map((r) => ({
    id: r.id,
    tableId: r.tableId,
    tableName: r.table.name,
    kind: r.kind,
    status: r.status,
    items: ((r.items as RequestLine[] | null) ?? []).map((l) => ({
      dishId: l.dishId,
      name: dish.get(l.dishId) ?? '(món đã xoá)',
      qty: l.qty,
      options: l.optionIds
        .map((id) => option.get(id) ?? '')
        .filter(Boolean)
        .join(', '),
      note: l.note,
    })),
    note: r.note,
    orderId: r.orderId,
    handledByName: r.handledById ? (user.get(r.handledById) ?? null) : null,
    rejectReason: r.rejectReason,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Waiting requests (and the ones handled in the last hour, so other tills see who took them). */
export async function list(): Promise<TableRequestDto[]> {
  const rows = await prisma.tableRequest.findMany({
    where: {
      branchId: await defaultBranchId(),
      OR: [
        { status: 'PENDING', createdAt: { gte: staleSince() } },
        { handledAt: { gte: new Date(Date.now() - 3600_000) } },
      ],
    },
    include,
    orderBy: { id: 'asc' },
  });
  return toDtos(rows);
}

async function one(id: number) {
  const r = await prisma.tableRequest.findUniqueOrThrow({ where: { id }, include });
  return (await toDtos([r]))[0]!;
}

/** Take a waiting request (only one till wins). */
async function claim(user: AuthUser, id: number, data: Prisma.TableRequestUpdateManyMutationInput) {
  const r = await prisma.tableRequest.findUnique({ where: { id } });
  if (!r) throw notFound('Không tìm thấy yêu cầu');
  const won = await prisma.tableRequest.updateMany({
    where: { id, status: 'PENDING' },
    data: { ...data, handledById: user.id, handledAt: new Date() },
  });
  if (!won.count) throw conflict('ALREADY_HANDLED', 'Yêu cầu này đã được xử lý');
  return r;
}

/** Ordering: the dishes go into the table's open order (a new order when none), not yet sent to the kitchen. */
export async function accept(user: AuthUser, id: number) {
  const r = await claim(user, id, { status: 'ACCEPTED' });
  if (r.kind === 'ORDER') {
    try {
      const items = ((r.items as RequestLine[] | null) ?? []).map((l) => ({
        dishId: l.dishId,
        qty: l.qty,
        note: l.note,
        optionIds: l.optionIds,
      }));
      const open = await prisma.order.findFirst({
        where: { tableId: r.tableId, status: 'OPEN' },
        orderBy: { id: 'asc' },
      });
      const o = open
        ? await orders.addItems(open.id, open.version, items)
        : await orders.open(user, {
            channel: 'DINE_IN',
            tableId: r.tableId,
            deliveryAppId: null,
            appOrderCode: null,
            guestCount: 1,
            note: null,
            items,
          });
      // The guest's note goes on the order (kitchen tickets and the till show it).
      if (r.note)
        await orders.update(user, o.id, {
          version: o.version,
          note: [o.note, `QR: ${r.note}`].filter(Boolean).join(' · ').slice(0, 200),
        });
      await prisma.tableRequest.update({ where: { id }, data: { orderId: o.id } });
    } catch (e) {
      // Nothing was added (sold out meanwhile…): back to waiting, the till shows why.
      await prisma.tableRequest.update({
        where: { id },
        data: { status: 'PENDING', handledById: null, handledAt: null },
      });
      throw e;
    }
  }
  emit(socketRooms.pos, 'table:request', { tableId: r.tableId, requestId: id, title: null });
  return one(id);
}

export async function reject(user: AuthUser, id: number, reason: string) {
  const r = await claim(user, id, { status: 'REJECTED', rejectReason: reason });
  emit(socketRooms.pos, 'table:request', { tableId: r.tableId, requestId: id, title: null });
  return one(id);
}

/** QR codes of the active tables: tables without one get a code; `renewTableId` gets a new one (old QR stops). */
export async function qrCodes(user: AuthUser, renewTableId: number | null) {
  if (renewTableId !== null) {
    const t = await prisma.diningTable.findUnique({ where: { id: renewTableId } });
    if (!t) throw notFound('Không tìm thấy bàn');
    await prisma.diningTable.update({ where: { id: t.id }, data: { qrToken: newToken() } });
    await writeAudit(prisma, { entity: 'table', entityId: t.id, action: 'RENEW_QR', userId: user.id });
  }
  const tables = await prisma.diningTable.findMany({
    where: { active: true },
    include: { area: true },
    orderBy: [{ area: { sort: 'asc' } }, { sort: 'asc' }, { name: 'asc' }],
  });
  for (const t of tables)
    if (!t.qrToken)
      t.qrToken = (
        await prisma.diningTable.update({ where: { id: t.id }, data: { qrToken: newToken() } })
      ).qrToken;
  return tables.map((t) => ({ tableId: t.id, tableName: t.name, areaName: t.area.name, token: t.qrToken! }));
}
