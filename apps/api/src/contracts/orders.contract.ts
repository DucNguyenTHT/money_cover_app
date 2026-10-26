import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import {
  CANCEL_KINDS,
  CHANNELS,
  DISCOUNT_TYPES,
  ITEM_STATUSES,
  KITCHEN_STATUSES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  STATIONS,
  VAT_MODES,
} from '../domain/enums';
import { commonErrors, decimalString, isoDate, reason, type RouteMeta } from './common';
import { dayTransferSchema } from './bank.contract';
import { buyerSchema, orderEInvoiceSchema } from './einvoice.contract';

const c = initContract();
const sellers = { roles: ['ADMIN', 'STAFF'] } satisfies RouteMeta;
const id = z.object({ id: z.coerce.number().int() });
const itemPath = z.object({ id: z.coerce.number().int(), itemId: z.coerce.number().int() });
/** Every change to an open order sends the version it was looking at; a stale one gets 409 STALE_ORDER. */
const version = z.number().int();
const money = decimalString.refine((v) => Number(v) >= 0, 'Không được âm');
/** ADMIN approval typed at the till (admin picks their name, types their PIN). */
export const approvalSchema = z.object({
  approverId: z.number().int(),
  pin: z.string().regex(/^\d{4,6}$/, 'PIN gồm 4–6 chữ số'),
});

export const orderItemSchema = z.object({
  id: z.number(),
  dishId: z.number(),
  dishName: z.string(),
  station: z.enum(STATIONS),
  qty: z.number(),
  /** Dish price before options; unitPrice = basePrice + the options' prices. */
  basePrice: decimalString,
  unitPrice: decimalString,
  /** Options chosen (size, toppings, requests), as sold. */
  options: z.array(
    z.object({
      optionId: z.number().nullable(),
      groupName: z.string(),
      name: z.string(),
      price: decimalString,
    }),
  ),
  discountAmount: decimalString,
  discountReason: z.string().nullable(),
  /** Automatic promotion (happy hour / combo) on this line. */
  promoDiscount: decimalString,
  promotionName: z.string().nullable(),
  amount: decimalString,
  netAmount: decimalString,
  costTotal: decimalString.optional(),
  note: z.string().nullable(),
  kitchenStatus: z.enum(KITCHEN_STATUSES),
  sentAt: z.string().nullable(),
  status: z.enum(ITEM_STATUSES),
  cancelReason: z.string().nullable(),
  wasted: z.boolean(),
});
export type OrderItemDto = z.infer<typeof orderItemSchema>;

export const paymentSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  amount: decimalString,
  cashReceived: decimalString.nullable(),
  change: decimalString.nullable(),
});

export const orderSchema = z.object({
  id: z.number(),
  code: z.string(),
  businessDate: isoDate,
  channel: z.enum(CHANNELS),
  tableId: z.number().nullable(),
  tableName: z.string().nullable(),
  areaName: z.string().nullable(),
  deliveryAppId: z.number().nullable(),
  deliveryAppName: z.string().nullable(),
  appOrderCode: z.string().nullable(),
  guestCount: z.number(),
  status: z.enum(ORDER_STATUSES),
  cancelKind: z.enum(CANCEL_KINDS).nullable(),
  splitFromOrderId: z.number().nullable(),
  subtotal: decimalString,
  itemDiscountTotal: decimalString,
  promoDiscountTotal: decimalString,
  orderDiscountType: z.enum(DISCOUNT_TYPES).nullable(),
  orderDiscountValue: decimalString.nullable(),
  orderDiscountAmount: decimalString,
  discountReason: z.string().nullable(),
  serviceChargePct: decimalString,
  serviceChargeAmount: decimalString,
  netRevenue: decimalString,
  vatPct: decimalString,
  vatMode: z.enum(VAT_MODES),
  vatAmount: decimalString,
  total: decimalString,
  appCommission: decimalString,
  costTotal: decimalString.optional(),
  note: z.string().nullable(),
  version: z.number(),
  billPrintedAt: z.string().nullable(),
  openedAt: z.string(),
  openedByName: z.string(),
  paidAt: z.string().nullable(),
  paidByName: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  cancelledByName: z.string().nullable(),
  cancelReason: z.string().nullable(),
  items: z.array(orderItemSchema),
  payments: z.array(paymentSchema),
  /** Money matched to this order on the shop's bank account (bank feed; "0" without one). */
  transferReceived: decimalString,
  /** E-invoice of the sale (null = none). */
  einvoice: orderEInvoiceSchema.nullable(),
  /** Regular customer of the order (points). */
  customer: z.object({ id: z.number(), name: z.string(), phone: z.string(), points: z.number() }).nullable(),
  pointsRedeemed: z.number(),
  pointsDiscount: decimalString,
  pointsEarned: z.number(),
});
export type OrderDto = z.infer<typeof orderSchema>;

export const orderSummarySchema = orderSchema
  .pick({
    id: true,
    code: true,
    businessDate: true,
    channel: true,
    tableId: true,
    tableName: true,
    deliveryAppName: true,
    appOrderCode: true,
    guestCount: true,
    status: true,
    cancelKind: true,
    total: true,
    netRevenue: true,
    costTotal: true,
    openedAt: true,
    openedByName: true,
    paidAt: true,
    cancelReason: true,
    cancelledByName: true,
    billPrintedAt: true,
  })
  .extend({
    itemCount: z.number(),
    hasUnsent: z.boolean(),
    orderDiscountAmount: decimalString,
    itemDiscountTotal: decimalString,
    promoDiscountTotal: decimalString,
  });
export type OrderSummary = z.infer<typeof orderSummarySchema>;

export const floorSchema = z.object({
  areas: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      tables: z.array(
        z.object({
          id: z.number(),
          name: z.string(),
          seats: z.number(),
          orders: z.array(orderSummarySchema),
        }),
      ),
    }),
  ),
  /** Open takeaway / app orders (no table). */
  others: z.array(orderSummarySchema),
});
export type Floor = z.infer<typeof floorSchema>;

export const billSchema = z.object({
  branch: z.object({ name: z.string(), address: z.string(), phone: z.string() }),
  footer: z.string(),
  /** VietQR payload for the amount due, null when no bank account is set up. */
  qr: z.string().nullable(),
  bankAccount: z.string().nullable(),
  order: orderSchema,
});
export type BillDto = z.infer<typeof billSchema>;

/** `printed` = the LAN printers took every ticket; false → the till prints from the browser instead. */
const withWarnings = z.object({
  order: orderSchema,
  printed: z.boolean(),
  printWarnings: z.array(z.string()),
});

const newItem = z.object({
  dishId: z.number().int(),
  qty: z.number().int().min(1).max(999),
  note: z.string().trim().max(120).nullable().optional(),
  /** Options picked; omitted = the defaults of the dish's option groups. */
  optionIds: z.array(z.number().int()).optional(),
});

export const openOrderInput = z.object({
  channel: z.enum(CHANNELS),
  tableId: z.number().int().nullable(),
  deliveryAppId: z.number().int().nullable(),
  appOrderCode: z.string().trim().max(40).nullable(),
  guestCount: z.number().int().min(1).max(200),
  note: z.string().trim().max(200).nullable(),
  items: z.array(newItem).default([]),
});

export const payInput = z.object({
  version,
  payments: z
    .array(
      z.object({ method: z.enum(PAYMENT_METHODS), amount: money, cashReceived: money.nullable().optional() }),
    )
    .min(1),
  /** Required when the order sells below cost (409 BELOW_COST asks for it). */
  belowCostReason: reason.optional(),
  print: z.boolean().default(true),
  /** E-invoice: `issue` asks for one when the shop issues on demand (always issued in automatic mode). */
  einvoice: z.object({ issue: z.boolean().optional(), buyer: buyerSchema.optional() }).optional(),
});

export const ordersContract = c.router(
  {
    floor: {
      method: 'GET',
      path: '/api/pos/floor',
      responses: { 200: floorSchema, ...commonErrors },
      metadata: sellers,
      summary: 'Sơ đồ bàn + đơn đang mở',
    },
    list: {
      method: 'GET',
      path: '/api/orders',
      query: z.object({
        from: isoDate,
        to: isoDate,
        status: z.enum(ORDER_STATUSES).optional(),
        channel: z.enum(CHANNELS).optional(),
        q: z.string().optional(),
      }),
      responses: { 200: z.array(orderSummarySchema), ...commonErrors },
      metadata: sellers,
    },
    get: {
      method: 'GET',
      path: '/api/orders/:id',
      pathParams: id,
      responses: { 200: orderSchema, ...commonErrors },
      metadata: sellers,
    },
    bill: {
      method: 'GET',
      path: '/api/orders/:id/bill',
      pathParams: id,
      responses: { 200: billSchema, ...commonErrors },
      metadata: sellers,
    },
    open: {
      method: 'POST',
      path: '/api/orders',
      body: openOrderInput,
      responses: { 201: orderSchema, ...commonErrors },
      metadata: sellers,
    },
    update: {
      method: 'PATCH',
      path: '/api/orders/:id',
      pathParams: id,
      body: z.object({
        version,
        guestCount: z.number().int().min(1).max(200).optional(),
        note: z.string().trim().max(200).nullable().optional(),
        appOrderCode: z.string().trim().max(40).nullable().optional(),
        /** Regular customer (null = none). */
        customerId: z.number().int().nullable().optional(),
      }),
      responses: { 200: orderSchema, ...commonErrors },
      metadata: sellers,
    },
    redeemPoints: {
      method: 'POST',
      path: '/api/orders/:id/points',
      pathParams: id,
      body: z.object({ version, points: z.number().int().min(0) }),
      responses: { 200: orderSchema, ...commonErrors },
      metadata: sellers,
      summary: 'Đổi điểm của khách quen lấy tiền trên đơn (0 = bỏ)',
    },
    addItems: {
      method: 'POST',
      path: '/api/orders/:id/items',
      pathParams: id,
      body: z.object({ version, items: z.array(newItem).min(1) }),
      responses: { 200: orderSchema, ...commonErrors },
      metadata: sellers,
    },
    updateItem: {
      method: 'PATCH',
      path: '/api/orders/:id/items/:itemId',
      pathParams: itemPath,
      body: z.object({
        version,
        qty: z.number().int().min(1).max(999).optional(),
        note: z.string().trim().max(120).nullable().optional(),
        /** Change the options (line not sent to the kitchen yet): re-priced. */
        optionIds: z.array(z.number().int()).optional(),
        discountAmount: money.optional(),
        discountReason: z.string().trim().max(200).nullable().optional(),
        approval: approvalSchema.optional(),
      }),
      responses: { 200: orderSchema, ...commonErrors },
      metadata: sellers,
      summary: 'Sửa SL / ghi chú (món chưa gửi bếp) hoặc giảm giá món',
    },
    removeItem: {
      method: 'DELETE',
      path: '/api/orders/:id/items/:itemId',
      pathParams: itemPath,
      body: z.object({ version }),
      responses: { 200: orderSchema, ...commonErrors },
      metadata: sellers,
      summary: 'Xoá món chưa gửi bếp',
    },
    cancelItem: {
      method: 'POST',
      path: '/api/orders/:id/items/:itemId/cancel',
      pathParams: itemPath,
      body: z.object({ version, qty: z.number().int().min(1).optional(), reason, wasted: z.boolean() }),
      responses: { 200: orderSchema, ...commonErrors },
      metadata: sellers,
      summary: 'Huỷ món đã gửi bếp (có lý do, đã chế biến hay chưa)',
    },
    sendKitchen: {
      method: 'POST',
      path: '/api/orders/:id/send-kitchen',
      pathParams: id,
      body: z.object({ version }),
      responses: { 200: withWarnings, ...commonErrors },
      metadata: sellers,
    },
    discount: {
      method: 'PATCH',
      path: '/api/orders/:id/discount',
      pathParams: id,
      body: z.object({
        version,
        type: z.enum(DISCOUNT_TYPES).nullable(),
        value: money,
        reason: z.string().trim().max(200).nullable(),
        approval: approvalSchema.optional(),
      }),
      responses: { 200: orderSchema, ...commonErrors },
      metadata: sellers,
    },
    move: {
      method: 'POST',
      path: '/api/orders/:id/move',
      pathParams: id,
      body: z.object({ version, tableId: z.number().int() }),
      responses: { 200: orderSchema, ...commonErrors },
      metadata: sellers,
    },
    merge: {
      method: 'POST',
      path: '/api/orders/:id/merge',
      pathParams: id,
      body: z.object({ version, targetOrderId: z.number().int() }),
      responses: { 200: orderSchema, ...commonErrors },
      metadata: sellers,
      summary: 'Gộp đơn này vào đơn đích; trả về đơn đích',
    },
    split: {
      method: 'POST',
      path: '/api/orders/:id/split',
      pathParams: id,
      body: z.object({
        version,
        lines: z.array(z.object({ itemId: z.number().int(), qty: z.number().int().min(1) })).min(1),
        /** null = same table (or no table for takeaway/app). */
        tableId: z.number().int().nullable(),
      }),
      responses: { 200: z.object({ source: orderSchema, created: orderSchema }), ...commonErrors },
      metadata: sellers,
    },
    print: {
      method: 'POST',
      path: '/api/orders/:id/print',
      pathParams: id,
      body: z.object({ kind: z.enum(['PROVISIONAL', 'BILL', 'KITCHEN']) }),
      responses: { 200: z.object({ printed: z.boolean(), message: z.string() }), ...commonErrors },
      metadata: sellers,
      summary: 'In tạm tính / in lại hoá đơn / in lại phiếu bếp qua máy in LAN',
    },
    pay: {
      method: 'POST',
      path: '/api/orders/:id/pay',
      pathParams: id,
      body: payInput,
      responses: { 200: withWarnings, ...commonErrors },
      metadata: sellers,
    },
    cancel: {
      method: 'POST',
      path: '/api/orders/:id/cancel',
      pathParams: id,
      body: z.object({
        reason,
        wastedItemIds: z.array(z.number().int()).default([]),
        approval: approvalSchema.optional(),
      }),
      responses: { 200: orderSchema, ...commonErrors },
      metadata: sellers,
    },
    duplicate: {
      method: 'POST',
      path: '/api/orders/:id/duplicate',
      pathParams: id,
      body: z.object({}),
      responses: { 201: orderSchema, ...commonErrors },
      metadata: sellers,
      summary: 'Sao chép món sang đơn mới (sửa đơn đã thanh toán = huỷ + tạo lại)',
    },
  },
  { strictStatusCodes: true },
);

// ---------------------------------------------------------------- kitchen / bar

export const kitchenItemSchema = z.object({
  itemId: z.number(),
  orderId: z.number(),
  orderCode: z.string(),
  where: z.string(),
  dishName: z.string(),
  qty: z.number(),
  /** "Lớn · Trứng, Thịt · Ít cay" (empty when none). */
  options: z.string(),
  note: z.string().nullable(),
  kitchenStatus: z.enum(KITCHEN_STATUSES),
  sentAt: z.string(),
  doneAt: z.string().nullable(),
});
export type KitchenItem = z.infer<typeof kitchenItemSchema>;

const kitchenRoles = { roles: ['ADMIN', 'STAFF', 'KITCHEN'] } satisfies RouteMeta;

export const kitchenContract = c.router(
  {
    queue: {
      method: 'GET',
      path: '/api/kitchen/queue',
      query: z.object({ station: z.enum(STATIONS) }),
      responses: { 200: z.array(kitchenItemSchema), ...commonErrors },
      metadata: kitchenRoles,
    },
    setStatus: {
      method: 'PATCH',
      path: '/api/kitchen/items/:itemId',
      pathParams: z.object({ itemId: z.coerce.number().int() }),
      body: z.object({ status: z.enum(['SENT', 'DONE', 'SERVED']) }),
      responses: { 200: kitchenItemSchema, ...commonErrors },
      metadata: kitchenRoles,
    },
    doneAll: {
      method: 'POST',
      path: '/api/kitchen/done-all',
      body: z.object({ station: z.enum(STATIONS) }),
      responses: { 200: z.object({ count: z.number() }), ...commonErrors },
      metadata: kitchenRoles,
    },
  },
  { strictStatusCodes: true },
);

// ---------------------------------------------------------------- day closing

const byMethod = z.record(z.enum(PAYMENT_METHODS), decimalString);

export const dayClosingSchema = z.object({
  businessDate: isoDate,
  expectedCash: decimalString,
  countedCash: decimalString,
  diff: decimalString,
  expectedByMethod: byMethod,
  note: z.string().nullable(),
  needsReclose: z.boolean(),
  closedByName: z.string(),
  closedAt: z.string(),
});
export type DayClosingDto = z.infer<typeof dayClosingSchema>;

export const dayPreviewSchema = z.object({
  businessDate: isoDate,
  openOrders: z.number(),
  paidOrders: z.number(),
  cancelledOrders: z.number(),
  netRevenue: decimalString,
  vatAmount: decimalString,
  total: decimalString,
  byMethod,
  /** Cash taken from sales. */
  cashSales: decimalString,
  /** Cash book of the day (sổ quỹ): money put in / taken out of the till. */
  cashIn: decimalString,
  cashOut: decimalString,
  /** cashSales + cashIn − cashOut. */
  expectedCash: decimalString,
  closing: dayClosingSchema.nullable(),
  /** Transfers checked against the bank account (null without a bank feed). */
  transfer: dayTransferSchema,
});
export type DayPreview = z.infer<typeof dayPreviewSchema>;

export const dayClosingContract = c.router(
  {
    preview: {
      method: 'GET',
      path: '/api/day-closings/:date/preview',
      pathParams: z.object({ date: isoDate }),
      responses: { 200: dayPreviewSchema, ...commonErrors },
      metadata: sellers,
    },
    close: {
      method: 'POST',
      path: '/api/day-closings/:date',
      pathParams: z.object({ date: isoDate }),
      body: z.object({ countedCash: money, note: z.string().trim().max(300).nullable() }),
      responses: { 200: dayClosingSchema, ...commonErrors },
      metadata: sellers,
    },
    list: {
      method: 'GET',
      path: '/api/day-closings',
      query: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }),
      responses: { 200: z.array(dayClosingSchema), ...commonErrors },
      metadata: sellers,
    },
  },
  { strictStatusCodes: true },
);
