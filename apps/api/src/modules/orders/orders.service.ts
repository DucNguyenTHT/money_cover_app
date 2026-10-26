import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { prisma, inTx, type Db, type Tx } from '../../core/db';
import { AppError, badRequest, conflict, notFound } from '../../core/errors';
import { writeAudit } from '../../core/audit';
import { assertPeriodOpen } from '../../core/period-lock';
import { defaultBranchId } from '../../core/branch';
import { emit } from '../../core/realtime';
import type { AuthUser } from '../../core/auth';
import { socketRooms } from '../../contracts/socket-events';
import type {
  approvalSchema,
  BillDto,
  Floor,
  OrderDto,
  OrderItemDto,
  OrderSummary,
  openOrderInput,
  payInput,
} from '../../contracts/orders.contract';
import { fromDbDate, toDbDate, VN_OFFSET_MINUTES } from '../../domain/business-date';
import { sellingPrice } from '../../domain/pricing/price-list';
import { priceEntries } from '../menu/menu.service';
import { type Channel, type DiscountType, type OrderStatus, type Station } from '../../domain/enums';
import { D, Decimal, ZERO, allocateVnd, roundVnd } from '../../domain/money';
import { discountPct, orderTotals } from '../../domain/orders/totals';
import { checkPayments } from '../../domain/orders/payment';
import { cancelRule, orderCode } from '../../domain/orders/cancel-policy';
import { itemCosts } from '../../domain/orders/item-cost';
import { consumption, pickVersion } from '../../domain/recipes/recipes';
import {
  defaultOptionIds,
  resolveOptions,
  type OptionGroupDef,
  type ResolvedOptions,
} from '../../domain/menu/options';
import { groupsForDishes } from '../menu/options.service';
import { vietQrConfigured, vietQrPayload } from '../../domain/vietqr';
import { businessToday, getSettings, getView } from '../settings/settings.service';
import { verifyApproverPin } from '../auth/auth.service';
import {
  createIssueFromLots,
  deleteIssueRestoringLots,
  onIssueCostsChanged,
} from '../inventory/stock-engine';
import { billTicket, kitchenTicket, printTo } from './print';
import * as owner from '../notify/notify.service';
import * as einvoice from '../einvoice/einvoice.service';
import * as customers from '../customers/customers.service';
import * as promotions from '../promotions/promotions.service';
import { applyPromotions } from '../../domain/promotions/promotions';
import { earnedPoints, pointsValue, redeemProblem } from '../../domain/loyalty/points';
import { belowCostAlert, cancelPaidAlert, discountAlert } from '../../domain/notify/messages';

type Approval = z.infer<typeof approvalSchema>;

const include = {
  table: { include: { area: true } },
  deliveryApp: true,
  items: {
    include: {
      dish: true,
      options: { orderBy: { id: 'asc' } },
      extras: true,
      promotion: { select: { name: true } },
    },
    orderBy: { id: 'asc' },
  },
  payments: { orderBy: { id: 'asc' } },
  // Money matched on the bank account (bank feed); ignored transactions are never tied to an order.
  bankTransactions: { where: { ignoredAt: null }, select: { amount: true } },
  einvoices: { orderBy: { id: 'asc' } },
  customer: true,
} as const;
type OrderRow = Prisma.OrderGetPayload<{ include: typeof include }>;

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const str = (d: Prisma.Decimal | null) => (d ? d.toString() : null);

async function userNames(db: Db, ids: (number | null)[]) {
  const wanted = [...new Set(ids.filter((x): x is number => x != null))];
  const rows = wanted.length
    ? await db.user.findMany({ where: { id: { in: wanted } }, select: { id: true, fullName: true } })
    : [];
  return new Map(rows.map((u) => [u.id, u.fullName]));
}

function toItem(i: OrderRow['items'][number]): OrderItemDto {
  return {
    id: i.id,
    dishId: i.dishId,
    dishName: i.dish.name,
    station: i.station,
    qty: i.qty,
    basePrice: i.basePrice.toString(),
    unitPrice: i.unitPrice.toString(),
    options: i.options.map((o) => ({
      optionId: o.optionId,
      groupName: o.groupName,
      name: o.name,
      price: o.price.toString(),
    })),
    discountAmount: i.discountAmount.toString(),
    discountReason: i.discountReason,
    promoDiscount: i.promoDiscount.toString(),
    promotionName: i.promotion?.name ?? null,
    amount: i.amount.toString(),
    netAmount: i.netAmount.toString(),
    costTotal: i.costTotal.toString(),
    note: i.note,
    kitchenStatus: i.kitchenStatus,
    sentAt: iso(i.sentAt),
    status: i.status,
    cancelReason: i.cancelReason,
    wasted: i.wasted,
  };
}

function toDto(o: OrderRow, names: Map<number, string>): OrderDto {
  return {
    id: o.id,
    code: o.code,
    businessDate: fromDbDate(o.businessDate),
    channel: o.channel,
    tableId: o.tableId,
    tableName: o.table?.name ?? null,
    areaName: o.table?.area.name ?? null,
    deliveryAppId: o.deliveryAppId,
    deliveryAppName: o.deliveryApp?.name ?? null,
    appOrderCode: o.appOrderCode,
    guestCount: o.guestCount,
    status: o.status,
    cancelKind: o.cancelKind,
    splitFromOrderId: o.splitFromOrderId,
    subtotal: o.subtotal.toString(),
    itemDiscountTotal: o.itemDiscountTotal.toString(),
    promoDiscountTotal: o.promoDiscountTotal.toString(),
    orderDiscountType: o.orderDiscountType,
    orderDiscountValue: str(o.orderDiscountValue),
    orderDiscountAmount: o.orderDiscountAmount.toString(),
    discountReason: o.discountReason,
    serviceChargePct: o.serviceChargePct.toString(),
    serviceChargeAmount: o.serviceChargeAmount.toString(),
    netRevenue: o.netRevenue.toString(),
    vatPct: o.vatPct.toString(),
    vatMode: o.vatMode,
    vatAmount: o.vatAmount.toString(),
    total: o.total.toString(),
    appCommission: o.appCommission.toString(),
    costTotal: o.costTotal.toString(),
    note: o.note,
    version: o.version,
    billPrintedAt: iso(o.billPrintedAt),
    openedAt: o.openedAt.toISOString(),
    openedByName: names.get(o.openedById) ?? '',
    paidAt: iso(o.paidAt),
    paidByName: o.paidById ? (names.get(o.paidById) ?? '') : null,
    cancelledAt: iso(o.cancelledAt),
    cancelledByName: o.cancelledById ? (names.get(o.cancelledById) ?? '') : null,
    cancelReason: o.cancelReason,
    items: o.items.map(toItem),
    payments: o.payments.map((p) => ({
      method: p.method,
      amount: p.amount.toString(),
      cashReceived: str(p.cashReceived),
      change: str(p.change),
    })),
    transferReceived: o.bankTransactions.reduce((sum, t) => sum.add(t.amount.toString()), ZERO).toString(),
    einvoice: einvoice.orderInvoice(o.einvoices),
    customer: o.customer
      ? { id: o.customer.id, name: o.customer.name, phone: o.customer.phone, points: o.customer.points }
      : null,
    pointsRedeemed: o.pointsRedeemed,
    pointsDiscount: o.pointsDiscount.toString(),
    pointsEarned: o.pointsEarned,
  };
}

function toSummary(o: OrderRow, names: Map<number, string>): OrderSummary {
  const active = o.items.filter((i) => i.status === 'ACTIVE');
  return {
    id: o.id,
    code: o.code,
    businessDate: fromDbDate(o.businessDate),
    channel: o.channel,
    tableId: o.tableId,
    tableName: o.table?.name ?? null,
    deliveryAppName: o.deliveryApp?.name ?? null,
    appOrderCode: o.appOrderCode,
    guestCount: o.guestCount,
    status: o.status,
    cancelKind: o.cancelKind,
    total: o.total.toString(),
    netRevenue: o.netRevenue.toString(),
    costTotal: o.costTotal.toString(),
    openedAt: o.openedAt.toISOString(),
    openedByName: names.get(o.openedById) ?? '',
    paidAt: iso(o.paidAt),
    cancelReason: o.cancelReason,
    cancelledByName: o.cancelledById ? (names.get(o.cancelledById) ?? '') : null,
    billPrintedAt: iso(o.billPrintedAt),
    itemCount: active.reduce((s, i) => s + i.qty, 0),
    hasUnsent: active.some((i) => i.kitchenStatus === 'NEW'),
    orderDiscountAmount: o.orderDiscountAmount.toString(),
    itemDiscountTotal: o.itemDiscountTotal.toString(),
    promoDiscountTotal: o.promoDiscountTotal.toString(),
  };
}

const namesFor = (db: Db, rows: OrderRow[]) =>
  userNames(
    db,
    rows.flatMap((o) => [o.openedById, o.paidById, o.cancelledById]),
  );

export async function getOrder(id: number, db: Db = prisma): Promise<OrderDto> {
  const o = await db.order.findUnique({ where: { id }, include });
  if (!o) throw notFound('Đơn hàng');
  return toDto(o, await namesFor(db, [o]));
}

function notify(...orders: { id: number; tableId: number | null }[]) {
  for (const o of orders) {
    emit(socketRooms.pos, 'order:update', { orderId: o.id });
    emit(socketRooms.pos, 'table:update', { tableId: o.tableId });
  }
}

// ---------------------------------------------------------------- read

export async function floor(): Promise<Floor> {
  const [areas, open] = await Promise.all([
    prisma.area.findMany({
      orderBy: [{ sort: 'asc' }, { id: 'asc' }],
      include: { tables: { where: { active: true }, orderBy: [{ sort: 'asc' }, { id: 'asc' }] } },
    }),
    prisma.order.findMany({ where: { status: 'OPEN' }, include, orderBy: { openedAt: 'asc' } }),
  ]);
  const names = await namesFor(prisma, open);
  const summaries = open.map((o) => toSummary(o, names));
  return {
    areas: areas.map((a) => ({
      id: a.id,
      name: a.name,
      tables: a.tables.map((t) => ({
        id: t.id,
        name: t.name,
        seats: t.seats,
        orders: summaries.filter((s) => s.tableId === t.id),
      })),
    })),
    others: summaries.filter((s) => s.tableId === null),
  };
}

export async function list(q: {
  from: string;
  to: string;
  status?: OrderStatus;
  channel?: Channel;
  q?: string;
}) {
  const rows = await prisma.order.findMany({
    where: {
      businessDate: { gte: toDbDate(q.from), lte: toDbDate(q.to) },
      ...(q.status ? { status: q.status } : {}),
      ...(q.channel ? { channel: q.channel } : {}),
      ...(q.q
        ? { OR: [{ code: { contains: q.q } }, { appOrderCode: { contains: q.q, mode: 'insensitive' } }] }
        : {}),
    },
    include,
    orderBy: { openedAt: 'desc' },
    take: 1000,
  });
  const names = await namesFor(prisma, rows);
  return rows.map((o) => toSummary(o, names));
}

export async function bill(id: number): Promise<BillDto> {
  const [order, view] = await Promise.all([getOrder(id), getView()]);
  const s = view.settings;
  const due = Number(order.total);
  const qr =
    vietQrConfigured(s.bank_bin, s.bank_account_no) && due > 0
      ? vietQrPayload({ bin: s.bank_bin, accountNo: s.bank_account_no, amount: due, purpose: order.code })
      : null;
  return {
    branch: view.branch,
    footer: s.bill_footer,
    qr,
    bankAccount: qr ? `${s.bank_account_no}${s.bank_account_name ? ` - ${s.bank_account_name}` : ''}` : null,
    order,
  };
}

// ---------------------------------------------------------------- helpers for writes

/** Lock an open order and check the caller saw its latest version. */
async function loadOpen(tx: Tx, id: number, version: number | null): Promise<OrderRow> {
  await tx.$queryRaw`SELECT id FROM orders WHERE id = ${id} FOR UPDATE`;
  const o = await tx.order.findUnique({ where: { id }, include });
  if (!o) throw notFound('Đơn hàng');
  if (o.status !== 'OPEN')
    throw conflict('ORDER_CLOSED', o.status === 'PAID' ? 'Đơn đã thanh toán' : 'Đơn đã bị huỷ');
  if (version !== null && o.version !== version) {
    throw conflict('STALE_ORDER', 'Đơn vừa được thay đổi trên máy khác — đã tải lại, vui lòng thao tác lại');
  }
  return o;
}

/** Recompute line and order totals from the active lines and bump the version. */
/** Minutes after local midnight (happy hour windows). */
const localMinute = (d: Date) => (Math.floor(d.getTime() / 60_000) + VN_OFFSET_MINUTES) % 1440;

async function recompute(tx: Tx, orderId: number): Promise<void> {
  const o = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      items: { orderBy: { id: 'asc' }, include: { dish: { select: { categoryId: true } } } },
      deliveryApp: true,
    },
  });
  const active = o.items.filter((i) => i.status === 'ACTIVE');
  // Happy hour and combos, worked out again on every change (a line discounted by hand gets none).
  const promos = applyPromotions(
    active.map((i) => ({
      dishId: i.dishId,
      categoryId: i.dish.categoryId,
      qty: i.qty,
      basePrice: i.basePrice.toString(),
      unitPrice: i.unitPrice.toString(),
      manualDiscount: !i.discountAmount.isZero(),
      minute: localMinute(i.createdAt),
    })),
    await promotions.rules(tx, o.branchId),
    { channel: o.channel, businessDate: fromDbDate(o.businessDate) },
  );
  const t = orderTotals({
    lines: active.map((i, k) => ({
      qty: i.qty,
      unitPrice: i.unitPrice.toString(),
      discountAmount: i.discountAmount.toString(),
      promoDiscount: promos[k]!.discount.toString(),
    })),
    orderDiscount: o.orderDiscountType
      ? { type: o.orderDiscountType, value: o.orderDiscountValue?.toString() ?? 0 }
      : null,
    pointsDiscount: o.pointsDiscount.toString(),
    serviceChargePct: o.serviceChargePct.toString(),
    vatPct: o.vatPct.toString(),
    vatMode: o.vatMode,
  });
  // Dishes removed after spending points: the points no longer fit — the redemption is dropped (spend again).
  if (t.pointsDiscountAmount.lt(o.pointsDiscount.toString())) {
    await tx.order.update({ where: { id: orderId }, data: { pointsRedeemed: 0, pointsDiscount: 0 } });
    return recompute(tx, orderId);
  }
  for (const [k, i] of active.entries()) {
    const l = t.lines[k]!;
    const promo = promos[k]!;
    if (
      !i.amount.equals(l.amount.toString()) ||
      !i.netAmount.equals(l.netAmount.toString()) ||
      !i.promoDiscount.equals(promo.discount.toString()) ||
      i.promotionId !== promo.promotionId
    ) {
      await tx.orderItem.update({
        where: { id: i.id },
        data: {
          amount: l.amount.toString(),
          netAmount: l.netAmount.toString(),
          promoDiscount: promo.discount.toString(),
          promotionId: promo.promotionId,
        },
      });
    }
  }
  const dropped = o.items.filter((i) => i.status !== 'ACTIVE' && i.promotionId !== null).map((i) => i.id);
  if (dropped.length)
    await tx.orderItem.updateMany({
      where: { id: { in: dropped } },
      data: { promoDiscount: 0, promotionId: null },
    });
  const commission = o.deliveryApp
    ? roundVnd(t.total.mul(o.deliveryApp.commissionPct.toString()).div(100))
    : ZERO;
  await tx.order.update({
    where: { id: orderId },
    data: {
      subtotal: t.subtotal.toString(),
      itemDiscountTotal: t.itemDiscountTotal.toString(),
      promoDiscountTotal: t.promoDiscountTotal.toString(),
      orderDiscountAmount: t.orderDiscountAmount.toString(),
      serviceChargeAmount: t.serviceChargeAmount.toString(),
      netRevenue: t.netRevenue.toString(),
      vatAmount: t.vatAmount.toString(),
      total: t.total.toString(),
      appCommission: commission.toString(),
      version: { increment: 1 },
    },
  });
}

/**
 * Staff may give away up to max_discount_pct of the order on their own; above that an ADMIN approves
 * (logged in, or PIN at the till). Returns the approver to record, or null.
 */
async function discountApproval(
  tx: Tx,
  user: AuthUser,
  orderId: number,
  approval?: Approval,
): Promise<number | null> {
  const o = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  const pct = discountPct({
    subtotal: D(o.subtotal.toString()),
    itemDiscountTotal: D(o.itemDiscountTotal.toString()),
    orderDiscountAmount: D(o.orderDiscountAmount.toString()),
  });
  const s = await getSettings(tx);
  if (user.role === 'ADMIN' || pct.lte(s.max_discount_pct))
    return user.role === 'ADMIN' && pct.gt(s.max_discount_pct) ? user.id : null;
  if (!approval) {
    throw new AppError(
      403,
      'NEEDS_APPROVAL',
      `Giảm giá ${pct.toDecimalPlaces(1).toString().replace('.', ',')}% vượt mức ${s.max_discount_pct}% — cần ADMIN duyệt bằng mã PIN`,
    );
  }
  return verifyApproverPin(tx, approval.approverId, approval.pin);
}

/** Tell the owner about a discount above the staff limit (not when an ADMIN gave it themselves). */
async function alertDiscount(
  tx: Tx,
  user: AuthUser,
  orderId: number,
  approvedBy: number,
  reason: string | null,
) {
  if (user.role === 'ADMIN' && approvedBy === user.id) return;
  const o = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  const approver = await tx.user.findUnique({ where: { id: approvedBy }, select: { fullName: true } });
  await owner.enqueue(
    tx,
    'ALERT',
    discountAlert({
      code: o.code,
      pct: discountPct({
        subtotal: D(o.subtotal.toString()),
        itemDiscountTotal: D(o.itemDiscountTotal.toString()),
        orderDiscountAmount: D(o.orderDiscountAmount.toString()),
      }),
      amount: D(o.itemDiscountTotal.toString()).add(o.orderDiscountAmount.toString()),
      reason,
      by: user.fullName,
      approvedBy: approver?.fullName ?? '',
    }),
  );
}

async function nextCode(tx: Tx, branchId: number, date: string) {
  const [row] = await tx.$queryRaw<{ last_no: number }[]>`
    INSERT INTO order_counters (branch_id, business_date, last_no) VALUES (${branchId}, ${toDbDate(date)}::date, 1)
    ON CONFLICT (branch_id, business_date) DO UPDATE SET last_no = order_counters.last_no + 1
    RETURNING last_no`;
  return orderCode(date, row!.last_no);
}

/** Options of a new / edited line, checked against the dish's groups (their defaults when not given). */
function lineOptions(groups: OptionGroupDef[], optionIds: number[] | undefined, dishName: string) {
  const r = resolveOptions(groups, optionIds ?? defaultOptionIds(groups));
  if ('error' in r) throw badRequest(`${dishName}: ${r.error}`);
  return r;
}

/** Snapshot of the chosen options and their extra ingredients, as nested creates of a line. */
const optionRows = (r: ResolvedOptions) => ({
  options: {
    create: r.chosen.map((c) => ({
      optionId: c.optionId,
      groupName: c.groupName,
      name: c.name,
      price: c.price.toString(),
    })),
  },
  extras: {
    create: r.extras.map((e) => ({ ingredientId: e.ingredientId, qty: e.qty.toDecimalPlaces(4).toString() })),
  },
});

/** Create data copying a line (another qty / order): its option and extra snapshots come along. */
function copyLine(it: OrderRow['items'][number]) {
  const { id: _id, dish: _dish, promotion: _promotion, options, extras, ...rest } = it;
  return {
    ...rest,
    options: { create: options.map(({ id: _o, orderItemId: _i, ...o }) => o) },
    extras: { create: extras.map(({ id: _e, orderItemId: _i, ...e }) => e) },
  };
}

/** Add dishes to an open order at the price for its channel (and delivery app) and business date. */
async function addItemsTx(
  tx: Tx,
  o: { id: number; channel: Channel; deliveryAppId: number | null; businessDate: Date },
  items: { dishId: number; qty: number; note?: string | null; optionIds?: number[] }[],
) {
  const date = fromDbDate(o.businessDate);
  const today = await businessToday(tx);
  const dishes = await tx.dish.findMany({
    where: { id: { in: items.map((i) => i.dishId) } },
    include: { category: true, prices: { orderBy: { effectiveFrom: 'desc' } }, recipes: true },
  });
  const existing = await tx.orderItem.findMany({
    where: { orderId: o.id, status: 'ACTIVE', kitchenStatus: 'NEW' },
  });
  const groups = await groupsForDishes(
    tx,
    dishes.map((d) => d.id),
  );
  for (const it of items) {
    const d = dishes.find((x) => x.id === it.dishId);
    if (!d || !d.active) throw badRequest('Món không tồn tại hoặc đã ngừng bán');
    if (d.soldOutDate && fromDbDate(d.soldOutDate) === today) throw conflict('SOLD_OUT', `${d.name} đã hết`);
    const price = sellingPrice(priceEntries(d.prices), o.channel, o.deliveryAppId, date);
    if (!price) throw badRequest(`${d.name} chưa có giá bán`);
    const recipe = pickVersion(
      d.recipes.map((r) => ({ ...r, effectiveFrom: fromDbDate(r.effectiveFrom) })),
      date,
    );
    const note = it.note?.trim() || null;
    const opts = lineOptions(groups.get(d.id) ?? [], it.optionIds, d.name);
    const unitPrice = D(price).add(opts.price);
    // Same dish, options, note and price, no discount: one line with a higher qty.
    const same = existing.find(
      (e) =>
        e.dishId === d.id &&
        e.note === note &&
        e.optionsKey === opts.key &&
        e.discountAmount.isZero() &&
        e.unitPrice.equals(unitPrice.toString()),
    );
    if (same) {
      same.qty += it.qty;
      await tx.orderItem.update({ where: { id: same.id }, data: { qty: same.qty } });
      continue;
    }
    const created = await tx.orderItem.create({
      data: {
        orderId: o.id,
        dishId: d.id,
        recipeId: recipe?.id ?? null,
        station: d.category.station,
        qty: it.qty,
        basePrice: price,
        unitPrice: unitPrice.toString(),
        recipeFactor: opts.factor.toString(),
        optionsKey: opts.key,
        amount: roundVnd(unitPrice.mul(it.qty)).toString(),
        note,
        ...optionRows(opts),
      },
    });
    existing.push(created);
  }
}

// ---------------------------------------------------------------- open / edit

export async function open(user: AuthUser, input: z.infer<typeof openOrderInput>) {
  const today = await businessToday();
  const s = await getSettings();
  if (input.channel === 'DINE_IN') {
    if (!input.tableId) throw badRequest('Chọn bàn');
    const t = await prisma.diningTable.findUnique({ where: { id: input.tableId } });
    if (!t || !t.active) throw badRequest('Bàn không tồn tại');
  }
  if (input.channel === 'APP') {
    const app = input.deliveryAppId
      ? await prisma.deliveryApp.findUnique({ where: { id: input.deliveryAppId } })
      : null;
    if (!app || !app.active) throw badRequest('Chọn app giao hàng');
  }
  const branchId = await defaultBranchId();
  const id = await inTx(async (tx) => {
    await assertPeriodOpen(tx, today);
    const o = await tx.order.create({
      data: {
        branchId,
        code: await nextCode(tx, branchId, today),
        businessDate: toDbDate(today),
        channel: input.channel,
        tableId: input.channel === 'DINE_IN' ? input.tableId : null,
        deliveryAppId: input.channel === 'APP' ? input.deliveryAppId : null,
        appOrderCode: input.channel === 'APP' ? input.appOrderCode : null,
        guestCount: input.guestCount,
        note: input.note,
        serviceChargePct: s.service_charge_channels.includes(input.channel) ? s.service_charge_pct : 0,
        // Hộ kinh doanh never shows VAT on the bill: its tax is a % of revenue (see domain/tax/household.ts).
        vatPct: s.tax_regime === 'HOUSEHOLD' ? 0 : s.vat_pct,
        vatMode: s.vat_mode,
        openedById: user.id,
      },
    });
    if (input.items.length) await addItemsTx(tx, o, input.items);
    await recompute(tx, o.id);
    return o.id;
  });
  const dto = await getOrder(id);
  notify(dto);
  return dto;
}

/** Run a change on an open order inside one transaction, then recompute, notify and return it. */
/** Promotions changed: open orders are worked out again (POS screens update through the socket). */
export async function refreshOpenOrders() {
  const open = await prisma.order.findMany({ where: { status: 'OPEN' }, select: { id: true } });
  for (const { id } of open) {
    await inTx((tx) => recompute(tx, id));
    notify(await getOrder(id));
  }
}

async function mutate(id: number, version: number | null, fn: (tx: Tx, o: OrderRow) => Promise<void>) {
  const before = await inTx(async (tx) => {
    const o = await loadOpen(tx, id, version);
    await fn(tx, o);
    await recompute(tx, id);
    return o;
  });
  const dto = await getOrder(id);
  notify(dto);
  if (before.tableId !== dto.tableId) notify({ id, tableId: before.tableId });
  return dto;
}

export const update = (
  user: AuthUser,
  id: number,
  b: {
    version: number;
    guestCount?: number;
    note?: string | null;
    appOrderCode?: string | null;
    customerId?: number | null;
  },
) =>
  mutate(id, b.version, async (tx, o) => {
    let customer = {};
    if (b.customerId !== undefined && b.customerId !== o.customerId) {
      if (b.customerId !== null) {
        const c = await tx.customer.findUnique({ where: { id: b.customerId } });
        if (!c || !c.active) throw badRequest('Khách hàng không tồn tại');
      }
      // Points spent belong to the customer: another customer (or none) starts again.
      customer = { customerId: b.customerId, pointsRedeemed: 0, pointsDiscount: 0 };
      await writeAudit(tx, {
        entity: 'order',
        entityId: id,
        action: 'SET_CUSTOMER',
        before: { customerId: o.customerId },
        after: { customerId: b.customerId },
        userId: user.id,
      });
    }
    await tx.order.update({
      where: { id },
      data: {
        ...(b.guestCount !== undefined ? { guestCount: b.guestCount } : {}),
        ...(b.note !== undefined ? { note: b.note || null } : {}),
        ...(b.appOrderCode !== undefined ? { appOrderCode: b.appOrderCode || null } : {}),
        ...customer,
      },
    });
  });

/** Spend a regular customer's points as money off the open order (0 = none). Deducted when the order is paid. */
export const redeemPoints = (user: AuthUser, id: number, version: number, points: number) =>
  mutate(id, version, async (tx, o) => {
    const s = await getSettings(tx);
    if (points > 0) {
      if (!s.loyalty_enabled) throw badRequest('Chưa bật tích điểm khách quen (Cài đặt)');
      if (!o.customer) throw badRequest('Chọn khách quen cho đơn trước');
      const base = D(o.subtotal.toString())
        .sub(o.itemDiscountTotal.toString())
        .sub(o.promoDiscountTotal.toString())
        .sub(o.orderDiscountAmount.toString());
      const problem = redeemProblem(points, o.customer.points, base, {
        earnVnd: s.loyalty_earn_vnd,
        pointValue: s.loyalty_point_value,
        minRedeem: s.loyalty_min_redeem,
        maxRedeemPct: s.loyalty_max_redeem_pct,
      });
      if (problem) throw badRequest(problem);
    }
    await tx.order.update({
      where: { id },
      data: { pointsRedeemed: points, pointsDiscount: pointsValue(points, s.loyalty_point_value).toString() },
    });
    await writeAudit(tx, {
      entity: 'order',
      entityId: id,
      action: 'REDEEM_POINTS',
      before: { points: o.pointsRedeemed },
      after: { points },
      userId: user.id,
    });
  });

export const addItems = (
  id: number,
  version: number,
  items: { dishId: number; qty: number; note?: string | null; optionIds?: number[] }[],
) => mutate(id, version, (tx, o) => addItemsTx(tx, o, items));

function findItem(o: OrderRow, itemId: number) {
  const it = o.items.find((i) => i.id === itemId);
  if (!it || it.status !== 'ACTIVE') throw notFound('Món trong đơn');
  return it;
}

export function updateItem(
  user: AuthUser,
  id: number,
  itemId: number,
  b: {
    version: number;
    qty?: number;
    note?: string | null;
    optionIds?: number[];
    discountAmount?: string;
    discountReason?: string | null;
    approval?: Approval;
  },
) {
  return mutate(id, b.version, async (tx, o) => {
    const it = findItem(o, itemId);
    if ((b.qty !== undefined && b.qty !== it.qty) || (b.note !== undefined && (b.note || null) !== it.note)) {
      if (it.kitchenStatus !== 'NEW')
        throw conflict('ITEM_SENT', 'Món đã gửi bếp — muốn bớt hãy dùng "Huỷ món"');
    }
    const data: Prisma.OrderItemUpdateInput = {};
    if (b.qty !== undefined) data.qty = b.qty;
    if (b.note !== undefined) data.note = b.note || null;
    let unitPrice = D(it.unitPrice.toString());
    if (b.optionIds !== undefined) {
      const groups = (await groupsForDishes(tx, [it.dishId])).get(it.dishId) ?? [];
      const opts = lineOptions(groups, b.optionIds, it.dish.name);
      if (opts.key !== it.optionsKey) {
        if (it.kitchenStatus !== 'NEW')
          throw conflict('ITEM_SENT', 'Món đã gửi bếp — không đổi tuỳ chọn được, hãy huỷ món và gọi lại');
        unitPrice = D(it.basePrice.toString()).add(opts.price);
        Object.assign(data, {
          unitPrice: unitPrice.toString(),
          recipeFactor: opts.factor.toString(),
          optionsKey: opts.key,
          options: { deleteMany: {}, ...optionRows(opts).options },
          extras: { deleteMany: {}, ...optionRows(opts).extras },
        });
      }
    }
    let discountChanged = false;
    if (b.discountAmount !== undefined) {
      const amount = roundVnd(b.discountAmount);
      const lineAmount = unitPrice.mul(b.qty ?? it.qty);
      if (amount.gt(lineAmount)) throw badRequest('Giảm giá lớn hơn tiền món');
      if (amount.gt(0) && !b.discountReason?.trim()) throw badRequest('Nhập lý do giảm giá');
      data.discountAmount = amount.toString();
      data.discountReason = amount.gt(0) ? b.discountReason!.trim() : null;
      discountChanged = !amount.equals(it.discountAmount.toString());
    }
    await tx.orderItem.update({ where: { id: itemId }, data });
    if (discountChanged) {
      await recompute(tx, id);
      const approvedBy = await discountApproval(tx, user, id, b.approval);
      if (approvedBy) {
        await tx.order.update({ where: { id }, data: { discountApprovedById: approvedBy } });
        await alertDiscount(tx, user, id, approvedBy, b.discountReason?.trim() || null);
      }
      await writeAudit(tx, {
        entity: 'order',
        entityId: id,
        action: 'ITEM_DISCOUNT',
        reason: b.discountReason ?? null,
        before: { itemId, discountAmount: it.discountAmount.toString() },
        after: { itemId, discountAmount: b.discountAmount },
        userId: user.id,
        approvedById: approvedBy,
      });
    }
  });
}

export const removeItem = (id: number, itemId: number, version: number) =>
  mutate(id, version, async (tx, o) => {
    const it = findItem(o, itemId);
    if (it.kitchenStatus !== 'NEW')
      throw conflict('ITEM_SENT', 'Món đã gửi bếp — dùng "Huỷ món" và nhập lý do');
    await tx.orderItem.delete({ where: { id: itemId } });
  });

export async function cancelItem(
  user: AuthUser,
  id: number,
  itemId: number,
  b: { version: number; qty?: number; reason: string; wasted: boolean },
) {
  let station: Station | null = null;
  const dto = await mutate(id, b.version, async (tx, o) => {
    const it = findItem(o, itemId);
    if (it.kitchenStatus === 'NEW') throw badRequest('Món chưa gửi bếp — xoá trực tiếp, không cần huỷ');
    const qty = Math.min(b.qty ?? it.qty, it.qty);
    const cancelled = {
      status: 'CANCELLED' as const,
      cancelReason: b.reason,
      cancelledById: user.id,
      cancelledAt: new Date(),
      wasted: b.wasted,
    };
    if (qty < it.qty) {
      await tx.orderItem.update({ where: { id: it.id }, data: { qty: it.qty - qty } });
      await tx.orderItem.create({
        data: {
          ...copyLine(it),
          qty,
          amount: roundVnd(D(it.unitPrice.toString()).mul(qty)).toString(),
          discountAmount: 0,
          netAmount: 0,
          ...cancelled,
        },
      });
    } else {
      await tx.orderItem.update({ where: { id: it.id }, data: cancelled });
    }
    station = it.station;
    await writeAudit(tx, {
      entity: 'order',
      entityId: id,
      action: 'CANCEL_ITEM',
      reason: b.reason,
      after: { itemId, dish: it.dish.name, qty, wasted: b.wasted },
      userId: user.id,
    });
  });
  if (station) emit(socketRooms.kitchen(station), 'kitchen:update', { station, itemIds: [itemId] });
  return dto;
}

export function discount(
  user: AuthUser,
  id: number,
  b: {
    version: number;
    type: DiscountType | null;
    value: string;
    reason: string | null;
    approval?: Approval;
  },
) {
  return mutate(id, b.version, async (tx, o) => {
    const value = D(b.value);
    const clear = !b.type || value.isZero();
    if (!clear && b.type === 'PERCENT' && value.gt(100)) throw badRequest('Giảm giá tối đa 100%');
    if (!clear && !b.reason?.trim()) throw badRequest('Nhập lý do giảm giá');
    await tx.order.update({
      where: { id },
      data: clear
        ? {
            orderDiscountType: null,
            orderDiscountValue: null,
            discountReason: null,
            discountApprovedById: null,
          }
        : {
            orderDiscountType: b.type,
            orderDiscountValue: value.toString(),
            discountReason: b.reason!.trim(),
          },
    });
    await recompute(tx, id);
    const approvedBy = clear ? null : await discountApproval(tx, user, id, b.approval);
    if (approvedBy) {
      await tx.order.update({ where: { id }, data: { discountApprovedById: approvedBy } });
      await alertDiscount(tx, user, id, approvedBy, b.reason?.trim() || null);
    }
    await writeAudit(tx, {
      entity: 'order',
      entityId: id,
      action: 'ORDER_DISCOUNT',
      reason: b.reason,
      before: { type: o.orderDiscountType, value: str(o.orderDiscountValue) },
      after: clear ? null : { type: b.type, value: b.value },
      userId: user.id,
      approvedById: approvedBy,
    });
  });
}

// ---------------------------------------------------------------- kitchen

async function printKitchen(order: OrderDto, items: OrderItemDto[], reprint = false) {
  const s = await getSettings();
  if (s.print_mode !== 'SERVER') return { printed: false, warnings: [] as string[] };
  const warnings: string[] = [];
  let printed = true;
  for (const station of ['KITCHEN', 'BAR'] as const) {
    const mine = items.filter((i) => i.station === station);
    if (!mine.length) continue;
    const r = await printTo(station, (w) => kitchenTicket(order, mine, station, w, reprint));
    warnings.push(...r.warnings);
    printed &&= r.printed && !r.warnings.length;
  }
  return { printed, warnings };
}

/** Mark NEW lines as sent (one batch per call). Returns the ids sent. */
async function sendNewTx(tx: Tx, o: OrderRow): Promise<number[]> {
  const fresh = o.items.filter((i) => i.status === 'ACTIVE' && i.kitchenStatus === 'NEW');
  if (!fresh.length) return [];
  const batch = Math.max(0, ...o.items.map((i) => i.kitchenBatch ?? 0)) + 1;
  await tx.orderItem.updateMany({
    where: { id: { in: fresh.map((i) => i.id) } },
    data: { kitchenStatus: 'SENT', kitchenBatch: batch, sentAt: new Date() },
  });
  return fresh.map((i) => i.id);
}

async function afterSend(order: OrderDto, sentIds: number[]) {
  if (!sentIds.length) return { printed: true, warnings: [] as string[] };
  const sent = order.items.filter((i) => sentIds.includes(i.id));
  for (const station of new Set(sent.map((i) => i.station)))
    emit(socketRooms.kitchen(station), 'kitchen:new', { station, orderId: order.id });
  return printKitchen(order, sent);
}

export async function sendKitchen(id: number, version: number) {
  let sentIds: number[] = [];
  const order = await mutate(id, version, async (tx, o) => {
    sentIds = await sendNewTx(tx, o);
    if (!sentIds.length) throw badRequest('Không có món mới để gửi bếp');
  });
  const r = await afterSend(order, sentIds);
  return { order, printed: r.printed, printWarnings: r.warnings };
}

// ---------------------------------------------------------------- tables

export const move = (user: AuthUser, id: number, version: number, tableId: number) =>
  mutate(id, version, async (tx, o) => {
    if (o.channel !== 'DINE_IN') throw badRequest('Chỉ đơn tại bàn mới chuyển bàn được');
    const t = await tx.diningTable.findUnique({ where: { id: tableId } });
    if (!t || !t.active) throw badRequest('Bàn không tồn tại');
    if (t.id === o.tableId) throw badRequest('Đơn đang ở bàn này');
    await tx.order.update({ where: { id }, data: { tableId } });
    await writeAudit(tx, {
      entity: 'order',
      entityId: id,
      action: 'MOVE_TABLE',
      before: o.table?.name,
      after: t.name,
      userId: user.id,
    });
  });

export async function merge(user: AuthUser, id: number, version: number, targetOrderId: number) {
  if (id === targetOrderId) throw badRequest('Chọn đơn khác để gộp');
  let source: OrderRow | null = null;
  await inTx(async (tx) => {
    // Lock both in id order to avoid deadlocks between two tills merging at once.
    const [first, second] = id < targetOrderId ? [id, targetOrderId] : [targetOrderId, id];
    const a = await loadOpen(tx, first, first === id ? version : null);
    const b = await loadOpen(tx, second, second === id ? version : null);
    const [src, dst] = a.id === id ? [a, b] : [b, a];
    await tx.orderItem.updateMany({ where: { orderId: src.id }, data: { orderId: dst.id } });
    // A transfer already received for the merged order now pays the target.
    await tx.bankTransaction.updateMany({ where: { orderId: src.id }, data: { orderId: dst.id } });
    await tx.order.update({
      where: { id: dst.id },
      data: {
        guestCount: dst.guestCount + src.guestCount,
        ...(dst.customerId === null && src.customerId !== null ? { customerId: src.customerId } : {}),
      },
    });
    await tx.order.update({
      where: { id: src.id },
      data: {
        status: 'CANCELLED',
        cancelKind: 'MERGED',
        cancelReason: `Gộp vào đơn ${dst.code}`,
        cancelledById: user.id,
        cancelledAt: new Date(),
        subtotal: 0,
        itemDiscountTotal: 0,
        orderDiscountAmount: 0,
        serviceChargeAmount: 0,
        netRevenue: 0,
        vatAmount: 0,
        total: 0,
        appCommission: 0,
        version: { increment: 1 },
      },
    });
    await recompute(tx, dst.id);
    await writeAudit(tx, {
      entity: 'order',
      entityId: src.id,
      action: 'MERGE',
      after: { into: dst.code },
      userId: user.id,
    });
    source = src;
  });
  const target = await getOrder(targetOrderId);
  const src = source as OrderRow | null;
  notify(target, ...(src ? [{ id: src.id, tableId: src.tableId }] : []));
  return target;
}

export async function split(
  user: AuthUser,
  id: number,
  b: { version: number; lines: { itemId: number; qty: number }[]; tableId: number | null },
) {
  let newId = 0;
  let oldTable: number | null = null;
  await inTx(async (tx) => {
    const o = await loadOpen(tx, id, b.version);
    oldTable = o.tableId;
    const active = o.items.filter((i) => i.status === 'ACTIVE');
    const moving = b.lines.map((l) => {
      const it = active.find((i) => i.id === l.itemId);
      if (!it) throw badRequest('Món không thuộc đơn này');
      if (l.qty > it.qty) throw badRequest(`${it.dish.name}: chỉ có ${it.qty} phần`);
      return { it, qty: l.qty };
    });
    const movedQty = new Map<number, number>();
    for (const m of moving) movedQty.set(m.it.id, (movedQty.get(m.it.id) ?? 0) + m.qty);
    if (active.every((i) => (movedQty.get(i.id) ?? 0) >= i.qty))
      throw badRequest('Không thể tách hết món — hãy dùng "Chuyển bàn"');

    let tableId = o.tableId;
    if (b.tableId !== null) {
      if (o.channel !== 'DINE_IN') throw badRequest('Đơn mang về / app không chọn bàn');
      const t = await tx.diningTable.findUnique({ where: { id: b.tableId } });
      if (!t || !t.active) throw badRequest('Bàn không tồn tại');
      tableId = t.id;
    }
    const today = await businessToday(tx);
    const created = await tx.order.create({
      data: {
        branchId: o.branchId,
        code: await nextCode(tx, o.branchId, today),
        businessDate: o.businessDate,
        channel: o.channel,
        tableId,
        deliveryAppId: o.deliveryAppId,
        appOrderCode: o.appOrderCode,
        guestCount: 1,
        splitFromOrderId: o.id,
        serviceChargePct: o.serviceChargePct,
        vatPct: o.vatPct,
        vatMode: o.vatMode,
        openedById: user.id,
      },
    });
    newId = created.id;

    let movedValue = ZERO;
    for (const { it, qty } of moving) {
      const share =
        it.qty === qty
          ? D(it.discountAmount.toString())
          : allocateVnd(it.discountAmount.toString(), [qty, it.qty - qty])[0]!;
      movedValue = movedValue.add(D(it.unitPrice.toString()).mul(qty)).sub(share);
      if (qty === it.qty) {
        await tx.orderItem.update({ where: { id: it.id }, data: { orderId: created.id } });
      } else {
        await tx.orderItem.create({
          data: { ...copyLine(it), orderId: created.id, qty, discountAmount: share.toString() },
        });
        await tx.orderItem.update({
          where: { id: it.id },
          data: { qty: it.qty - qty, discountAmount: D(it.discountAmount.toString()).sub(share).toString() },
        });
        it.qty -= qty;
      }
    }
    // The order discount follows the dishes: a percentage is copied, a fixed amount is shared by value.
    if (o.orderDiscountType === 'PERCENT') {
      await tx.order.update({
        where: { id: created.id },
        data: {
          orderDiscountType: 'PERCENT',
          orderDiscountValue: o.orderDiscountValue,
          discountReason: o.discountReason,
          discountApprovedById: o.discountApprovedById,
        },
      });
    } else if (o.orderDiscountType === 'AMOUNT' && o.orderDiscountValue) {
      const base = D(o.subtotal.toString()).sub(o.itemDiscountTotal.toString());
      const [moved, kept] = allocateVnd(o.orderDiscountValue.toString(), [
        movedValue,
        Decimal.max(ZERO, base.sub(movedValue)),
      ]);
      await tx.order.update({
        where: { id: created.id },
        data: {
          orderDiscountType: 'AMOUNT',
          orderDiscountValue: moved!.toString(),
          discountReason: o.discountReason,
          discountApprovedById: o.discountApprovedById,
        },
      });
      await tx.order.update({ where: { id: o.id }, data: { orderDiscountValue: kept!.toString() } });
    }
    await recompute(tx, o.id);
    await recompute(tx, created.id);
    await writeAudit(tx, {
      entity: 'order',
      entityId: o.id,
      action: 'SPLIT',
      after: { newOrderId: created.id, lines: b.lines },
      userId: user.id,
    });
  });
  const [source, created] = await Promise.all([getOrder(id), getOrder(newId)]);
  notify(source, created, { id, tableId: oldTable });
  return { source, created };
}

// ---------------------------------------------------------------- payment & stock

/** Ingredients (stock units) of each line for the order's channel: recipe × size factor + option extras. */
async function usageByLine(
  tx: Tx,
  items: {
    recipeId: number | null;
    qty: number;
    recipeFactor: Prisma.Decimal;
    extras: { ingredientId: number; qty: Prisma.Decimal }[];
  }[],
  channel: Channel,
) {
  const recipeIds = [...new Set(items.map((i) => i.recipeId).filter((x): x is number => x != null))];
  const recipeItems = recipeIds.length
    ? await tx.dishRecipeItem.findMany({ where: { recipeId: { in: recipeIds } } })
    : [];
  return items.map((i) =>
    consumption([
      {
        qty: i.qty,
        channel,
        recipe: recipeItems
          .filter((r) => r.recipeId === i.recipeId)
          .map((r) => ({ ingredientId: r.ingredientId, qty: r.qty.toString(), scope: r.scope })),
        factor: i.recipeFactor.toString(),
        extras: i.extras.map((e) => ({ ingredientId: e.ingredientId, qty: e.qty.toString() })),
      },
    ]),
  );
}

/** Spread the SALE_USE issue cost over the order's lines and store the order cost. */
async function applySaleCosts(tx: Tx, orderId: number) {
  const o = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: { where: { status: 'ACTIVE' }, orderBy: { id: 'asc' }, include: { extras: true } } },
  });
  const issue = await tx.issue.findFirst({
    where: { orderId, reason: 'SALE_USE' },
    include: { items: true },
  });
  const costByIng = new Map<number, Decimal>();
  for (const ii of issue?.items ?? [])
    costByIng.set(ii.ingredientId, (costByIng.get(ii.ingredientId) ?? ZERO).add(ii.costTotal.toString()));
  const usage = await usageByLine(tx, o.items, o.channel);
  const costs = itemCosts(usage, costByIng);
  for (const [k, it] of o.items.entries()) {
    await tx.orderItem.update({ where: { id: it.id }, data: { costTotal: costs[k]!.toString() } });
  }
  const total = costs.reduce((s, c) => s.add(c), ZERO);
  await tx.order.update({ where: { id: orderId }, data: { costTotal: total.toString() } });
  return total;
}

// When "nợ kho" is settled by a later receipt, the sale's cost changes: refresh the order.
onIssueCostsChanged(async (tx, issueIds) => {
  const issues = await tx.issue.findMany({
    where: { id: { in: issueIds }, reason: 'SALE_USE', orderId: { not: null } },
  });
  for (const i of issues) await applySaleCosts(tx, i.orderId!);
});

/** Cancelled-but-cooked lines become DISPOSAL issues (one per line, linked to it), once. */
async function issueWasted(tx: Tx, orderId: number, userId: number) {
  const o = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  const wasted = await tx.orderItem.findMany({
    where: { orderId, wasted: true },
    include: { dish: true, extras: true },
  });
  if (!wasted.length) return;
  const done = new Set(
    (
      await tx.issue.findMany({
        where: { orderId, reason: 'DISPOSAL', orderItemId: { not: null } },
        select: { orderItemId: true },
      })
    ).map((i) => i.orderItemId),
  );
  const todo = wasted.filter((w) => !done.has(w.id));
  const usage = await usageByLine(tx, todo, o.channel);
  for (const [k, w] of todo.entries()) {
    const lines = [...usage[k]!.entries()].map(([ingredientId, qty]) => ({ ingredientId, qty }));
    if (!lines.length) continue;
    await createIssueFromLots(tx, {
      branchId: o.branchId,
      date: fromDbDate(o.businessDate),
      reason: 'DISPOSAL',
      lines,
      createdById: userId,
      orderId,
      orderItemId: w.id,
      note: `Món huỷ đã chế biến: ${w.qty} × ${w.dish.name} (${o.code})`,
      allowPending: true,
    });
  }
}

export async function pay(user: AuthUser, id: number, b: z.infer<typeof payInput>) {
  let sentIds: number[] = [];
  const buyer = einvoice.buyerOf(b.einvoice?.buyer);
  let invoiceId: number | null = null;
  await inTx(async (tx) => {
    const o = await loadOpen(tx, id, b.version);
    const date = fromDbDate(o.businessDate);
    await assertPeriodOpen(tx, date);
    const active = o.items.filter((i) => i.status === 'ACTIVE');
    if (!active.length) throw badRequest('Đơn chưa có món');
    // Paying sends anything still unsent (takeaway is often paid before cooking).
    sentIds = await sendNewTx(tx, o);
    await recompute(tx, id);
    const fresh = await tx.order.findUniqueOrThrow({ where: { id } });
    const checked = checkPayments(fresh.total.toString(), b.payments);
    if ('error' in checked) throw badRequest(checked.error);

    const usage = await usageByLine(tx, active, o.channel);
    const totalUsage = new Map<number, Decimal>();
    for (const u of usage)
      for (const [ing, q] of u) totalUsage.set(ing, (totalUsage.get(ing) ?? ZERO).add(q));
    if (totalUsage.size) {
      await createIssueFromLots(tx, {
        branchId: o.branchId,
        date,
        reason: 'SALE_USE',
        lines: [...totalUsage.entries()].map(([ingredientId, qty]) => ({ ingredientId, qty })),
        createdById: user.id,
        orderId: id,
        note: `Bán hàng ${o.code}`,
        allowPending: true,
      });
    }
    const cost = await applySaleCosts(tx, id);
    await issueWasted(tx, id, user.id);

    const below = D(fresh.netRevenue.toString()).lt(cost);
    if (below && !b.belowCostReason) {
      throw conflict('BELOW_COST', 'Đơn đang bán dưới giá vốn — nhập lý do để tiếp tục thanh toán');
    }
    if (below)
      await owner.enqueue(
        tx,
        'ALERT',
        belowCostAlert({
          code: o.code,
          netRevenue: fresh.netRevenue.toString(),
          cost: cost.toString(),
          reason: b.belowCostReason ?? null,
          by: user.fullName,
        }),
      );
    await tx.orderPayment.createMany({
      data: checked.lines.map((p) => ({
        orderId: id,
        method: p.method,
        amount: p.amount.toString(),
        cashReceived: p.cashReceived?.toString() ?? null,
        change: p.change?.toString() ?? null,
      })),
    });
    await tx.order.update({
      where: { id },
      data: { status: 'PAID', paidById: user.id, paidAt: new Date(), version: { increment: 1 } },
    });
    if (o.customerId) await settlePointsTx(tx, id, o.customerId, user.id);
    await writeAudit(tx, {
      entity: 'order',
      entityId: id,
      action: 'PAY',
      reason: below ? b.belowCostReason : null,
      after: { total: fresh.total.toString(), payments: b.payments, belowCost: below },
      userId: user.id,
    });
    const inv = await einvoice.queueForPaymentTx(tx, id, !!b.einvoice?.issue, buyer, user.id);
    invoiceId = inv?.id ?? null;
  });
  // A few seconds for the e-invoice, so the bill can carry its number / lookup; it carries on in the background.
  if (invoiceId !== null) {
    await einvoice.tryNow(invoiceId, 6000).catch(() => undefined);
    einvoice.kick();
  }
  const order = await getOrder(id);
  notify(order);
  // Kitchen tickets for lines sent by paying are best-effort; `printed` reports the bill.
  const kitchen = await afterSend(order, sentIds);
  const printWarnings = [...kitchen.warnings];
  let printed = false;
  if (b.print) {
    const r = await printBill(id, false);
    printWarnings.push(...r.warnings);
    printed = r.printed && !r.warnings.length;
  }
  return { order, printed, printWarnings };
}

/** At payment: take the points spent, add the points earned, count the visit. */
async function settlePointsTx(tx: Tx, orderId: number, customerId: number, userId: number) {
  const o = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  const s = await getSettings(tx);
  const balance = await customers.lockBalance(tx, customerId);
  if (o.pointsRedeemed > 0) {
    if (balance < o.pointsRedeemed)
      throw conflict('POINTS_CHANGED', `Khách chỉ còn ${balance} điểm — đổi lại điểm rồi thanh toán`);
    await customers.addPointsTx(tx, customerId, 'REDEEM', -o.pointsRedeemed, {
      orderId,
      note: `Đổi điểm đơn ${o.code}`,
      userId,
    });
  }
  const earned = s.loyalty_enabled ? earnedPoints(o.netRevenue.toString(), s.loyalty_earn_vnd) : 0;
  if (earned)
    await customers.addPointsTx(tx, customerId, 'EARN', earned, { orderId, note: `Đơn ${o.code}`, userId });
  await tx.order.update({ where: { id: orderId }, data: { pointsEarned: earned } });
  await tx.customer.update({
    where: { id: customerId },
    data: { visits: { increment: 1 }, totalSpent: { increment: o.total }, lastVisitAt: new Date() },
  });
}

/** A paid order cancelled: its points go back the other way, the visit no longer counts. */
async function reversePointsTx(
  tx: Tx,
  o: {
    id: number;
    code: string;
    customerId: number | null;
    pointsEarned: number;
    pointsRedeemed: number;
    total: Prisma.Decimal;
  },
  userId: number,
) {
  const c = o.customerId!;
  const back = o.pointsRedeemed - o.pointsEarned;
  if (back)
    await customers.addPointsTx(tx, c, 'REVERSE', back, { orderId: o.id, note: `Huỷ đơn ${o.code}`, userId });
  const cur = await tx.customer.findUniqueOrThrow({ where: { id: c } });
  await tx.customer.update({
    where: { id: c },
    data: {
      visits: Math.max(0, cur.visits - 1),
      totalSpent: Decimal.max(ZERO, D(cur.totalSpent.toString()).sub(o.total.toString())).toString(),
    },
  });
}

// ---------------------------------------------------------------- cancel / duplicate

export async function cancel(
  user: AuthUser,
  id: number,
  b: { reason: string; wastedItemIds: number[]; approval?: Approval },
) {
  const today = await businessToday();
  let tableId: number | null = null;
  await inTx(async (tx) => {
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${id} FOR UPDATE`;
    const o = await tx.order.findUnique({ where: { id }, include });
    if (!o) throw notFound('Đơn hàng');
    tableId = o.tableId;
    const date = fromDbDate(o.businessDate);
    const closing = await tx.dayClosing.findUnique({
      where: { branchId_businessDate: { branchId: o.branchId, businessDate: o.businessDate } },
    });
    const rule = cancelRule({
      status: o.status,
      orderDate: date,
      today,
      role: user.role,
      dayClosed: !!closing,
    });
    if (rule === 'NOT_CANCELLABLE') throw conflict('ORDER_CLOSED', 'Đơn đã bị huỷ');
    let approvedBy: number | null = null;
    if (rule === 'NEEDS_ADMIN') {
      if (!b.approval)
        throw new AppError(
          403,
          'NEEDS_APPROVAL',
          'Huỷ đơn của ngày trước hoặc ngày đã chốt cần ADMIN duyệt bằng mã PIN',
        );
      approvedBy = await verifyApproverPin(tx, b.approval.approverId, b.approval.pin);
    }
    await assertPeriodOpen(tx, date);

    if (o.status === 'PAID') {
      const sales = await tx.issue.findMany({ where: { orderId: id, reason: 'SALE_USE' } });
      for (const s of sales) await deleteIssueRestoringLots(tx, s.id);
      await tx.orderItem.updateMany({ where: { orderId: id }, data: { costTotal: 0 } });
    }
    const wastedIds = b.wastedItemIds.filter((wid) =>
      o.items.some((i) => i.id === wid && i.status === 'ACTIVE'),
    );
    if (wastedIds.length)
      await tx.orderItem.updateMany({ where: { id: { in: wastedIds } }, data: { wasted: true } });
    await issueWasted(tx, id, user.id);

    await tx.order.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        cancelKind: 'CANCELLED',
        cancelReason: b.reason,
        cancelledById: approvedBy ?? user.id,
        cancelledAt: new Date(),
        costTotal: 0,
        version: { increment: 1 },
      },
    });
    if (closing) await tx.dayClosing.update({ where: { id: closing.id }, data: { needsReclose: true } });
    if (o.status === 'PAID') await einvoice.onOrderCancelledTx(tx, id, user.id);
    if (o.status === 'PAID' && o.customerId) await reversePointsTx(tx, o, user.id);
    if (o.status === 'PAID') {
      const approver = approvedBy
        ? await tx.user.findUnique({ where: { id: approvedBy }, select: { fullName: true } })
        : null;
      await owner.enqueue(
        tx,
        'ALERT',
        cancelPaidAlert({
          code: o.code,
          date,
          total: o.total.toString(),
          reason: b.reason,
          by: user.fullName,
          approvedBy: approver?.fullName ?? null,
        }),
      );
    }
    await writeAudit(tx, {
      entity: 'order',
      entityId: id,
      action: 'CANCEL',
      reason: b.reason,
      before: { status: o.status, total: o.total.toString() },
      after: { wastedItemIds: wastedIds },
      userId: user.id,
      approvedById: approvedBy,
    });
  });
  einvoice.kick();
  const order = await getOrder(id);
  notify(order, { id, tableId });
  const stations = new Set(
    order.items.filter((i) => i.kitchenStatus === 'SENT' || i.kitchenStatus === 'DONE').map((i) => i.station),
  );
  for (const station of stations)
    emit(socketRooms.kitchen(station), 'kitchen:update', { station, itemIds: order.items.map((i) => i.id) });
  return order;
}

export async function duplicate(user: AuthUser, id: number) {
  const src = await getOrder(id);
  const items = src.items
    .filter((i) => i.status === 'ACTIVE')
    .map((i) => ({ dishId: i.dishId, qty: i.qty, note: i.note }));
  const tableOk = src.tableId
    ? await prisma.diningTable.findFirst({ where: { id: src.tableId, active: true } })
    : null;
  return open(user, {
    channel: src.channel === 'DINE_IN' && !tableOk ? 'TAKEAWAY' : src.channel,
    tableId: src.channel === 'DINE_IN' && tableOk ? src.tableId : null,
    deliveryAppId: src.deliveryAppId,
    appOrderCode: src.appOrderCode,
    guestCount: src.guestCount,
    note: src.note,
    items,
  });
}

// ---------------------------------------------------------------- printing

async function printBill(id: number, provisional: boolean) {
  const s = await getSettings();
  if (s.print_mode !== 'SERVER') return { printed: false, warnings: [] as string[] };
  const b = await bill(id);
  return printTo('BILL', (w) => billTicket(b, w, provisional));
}

export async function print(id: number, kind: 'PROVISIONAL' | 'BILL' | 'KITCHEN') {
  const order = await getOrder(id);
  if (kind === 'PROVISIONAL') {
    if (order.status !== 'OPEN') throw badRequest('Đơn đã đóng — in lại hoá đơn');
    await prisma.order.update({ where: { id }, data: { billPrintedAt: new Date() } });
    notify(order);
  }
  if (kind === 'BILL' && order.status !== 'PAID') throw badRequest('Đơn chưa thanh toán — in tạm tính');
  const s = await getSettings();
  if (s.print_mode !== 'SERVER') return { printed: false, message: 'Đang dùng chế độ in qua trình duyệt' };
  if (kind === 'KITCHEN') {
    const sent = order.items.filter((i) => i.status === 'ACTIVE' && i.kitchenStatus !== 'NEW');
    if (!sent.length) throw badRequest('Chưa có món nào gửi bếp');
    const r = await printKitchen(order, sent, true);
    if (r.warnings.length) return { printed: false, message: r.warnings.join('; ') };
    return r.printed
      ? { printed: true, message: 'Đã in lại phiếu bếp' }
      : { printed: false, message: 'Chưa cài máy in bếp / bar — in qua trình duyệt' };
  }
  const r = await printBill(id, kind === 'PROVISIONAL');
  if (r.warnings.length) return { printed: false, message: r.warnings.join('; ') };
  return r.printed
    ? { printed: true, message: 'Đã gửi lệnh in' }
    : { printed: false, message: 'Chưa cài máy in hoá đơn — in qua trình duyệt' };
}
