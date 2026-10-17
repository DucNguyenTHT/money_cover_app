import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { ISSUE_REASONS, RECEIPT_KINDS } from '../domain/enums';
import { commonErrors, decimalString, isoDate, reason, type RouteMeta } from './common';

const c = initContract();
const staff = { roles: ['ADMIN', 'STAFF'] } satisfies RouteMeta;
const id = z.object({ id: z.coerce.number().int() });
const month = z.string().regex(/^\d{4}-\d{2}$/, 'Tháng dạng YYYY-MM');
const positive = decimalString.refine((v) => Number(v) > 0, 'Số lượng phải lớn hơn 0');
const nonNegative = decimalString.refine((v) => Number(v) >= 0, 'Không được âm');

// ---------------------------------------------------------------- receipts

export const receiptInput = z.object({
  kind: z.enum(RECEIPT_KINDS),
  date: isoDate,
  supplier: z.string().trim().max(120).nullable(),
  note: z.string().trim().max(500).nullable(),
  items: z
    .array(
      z.object({
        ingredientId: z.number().int(),
        /** Quantity and price in the unit chosen by `unitMode`. */
        qty: positive,
        unitPrice: nonNegative,
        unitMode: z.enum(['STOCK', 'PURCHASE']),
      }),
    )
    .min(1, 'Phiếu phải có ít nhất 1 dòng'),
});
export type ReceiptInput = z.infer<typeof receiptInput>;

export const receiptSummary = z.object({
  id: z.number(),
  kind: z.enum(RECEIPT_KINDS),
  date: isoDate,
  supplier: z.string().nullable(),
  itemCount: z.number(),
  total: decimalString,
  createdBy: z.string(),
  /** Some of its stock was already used → can't edit/delete. */
  consumed: z.boolean(),
  locked: z.boolean(),
  /** Invoices (Chứng từ) attached to this receipt. */
  documentCount: z.number(),
});
export type ReceiptSummary = z.infer<typeof receiptSummary>;

export const receiptDetail = receiptSummary.extend({
  note: z.string().nullable(),
  items: z.array(
    z.object({
      ingredientId: z.number(),
      ingredientName: z.string(),
      unit: z.string(),
      qty: decimalString,
      unitPrice: decimalString,
      purchaseUnit: z.string().nullable(),
      purchaseUnitQty: decimalString.nullable(),
      amount: decimalString,
      consumedQty: decimalString,
    }),
  ),
});
export type ReceiptDetail = z.infer<typeof receiptDetail>;

// ---------------------------------------------------------------- issues

const manualReasons = ['DISPOSAL', 'SUPPLIER_RETURN', 'INTERNAL_USE'] as const;

export const issueInput = z.object({
  reason: z.enum(manualReasons),
  date: isoDate,
  note: z.string().trim().max(500).nullable(),
  items: z
    .array(
      z.object({
        ingredientId: z.number().int(),
        qty: positive,
        /** Required for SUPPLIER_RETURN: the lot being returned. */
        lotId: z.number().int().nullable(),
      }),
    )
    .min(1, 'Phiếu phải có ít nhất 1 dòng'),
});
export type IssueInput = z.infer<typeof issueInput>;

export const issueSummary = z.object({
  id: z.number(),
  reason: z.enum(ISSUE_REASONS),
  date: isoDate,
  note: z.string().nullable(),
  itemCount: z.number(),
  costTotal: decimalString,
  pendingQty: decimalString,
  orderId: z.number().nullable(),
  createdBy: z.string(),
  locked: z.boolean(),
});
export type IssueSummary = z.infer<typeof issueSummary>;

export const issueDetail = issueSummary.extend({
  items: z.array(
    z.object({
      ingredientId: z.number(),
      ingredientName: z.string(),
      unit: z.string(),
      qty: decimalString,
      costTotal: decimalString,
      pendingQty: decimalString,
      allocations: z.array(
        z.object({ lotId: z.number(), lotDate: isoDate, qty: decimalString, unitPrice: decimalString }),
      ),
    }),
  ),
});
export type IssueDetail = z.infer<typeof issueDetail>;

// ---------------------------------------------------------------- stock

export const stockRow = z.object({
  ingredientId: z.number(),
  code: z.string(),
  name: z.string(),
  kind: z.string(),
  category: z.string().nullable(),
  unit: z.string(),
  qtyOnHand: decimalString,
  pendingQty: decimalString,
  value: decimalString,
  lastPrice: decimalString.nullable(),
});
export type StockRow = z.infer<typeof stockRow>;

export const lotRow = z.object({
  id: z.number(),
  date: isoDate,
  unitPrice: decimalString,
  qtyIn: decimalString,
  qtyRemaining: decimalString,
  source: z.string(),
});
export type LotRow = z.infer<typeof lotRow>;

export const inventoryContract = c.router(
  {
    listReceipts: {
      method: 'GET',
      path: '/api/receipts',
      query: z.object({ month }),
      metadata: staff,
      responses: { 200: z.array(receiptSummary), ...commonErrors },
    },
    suppliers: {
      method: 'GET',
      path: '/api/receipts/suppliers',
      metadata: staff,
      responses: { 200: z.array(z.string()), ...commonErrors },
    },
    getReceipt: {
      method: 'GET',
      path: '/api/receipts/:id',
      pathParams: id,
      metadata: staff,
      responses: { 200: receiptDetail, ...commonErrors },
    },
    createReceipt: {
      method: 'POST',
      path: '/api/receipts',
      body: receiptInput,
      metadata: staff,
      responses: { 201: receiptDetail, ...commonErrors },
    },
    updateReceipt: {
      method: 'PUT',
      path: '/api/receipts/:id',
      pathParams: id,
      body: receiptInput.extend({ reason }),
      metadata: staff,
      responses: { 200: receiptDetail, ...commonErrors },
    },
    deleteReceipt: {
      method: 'DELETE',
      path: '/api/receipts/:id',
      pathParams: id,
      body: z.object({ reason }),
      metadata: staff,
      responses: { 200: z.object({ ok: z.literal(true) }), ...commonErrors },
    },

    listIssues: {
      method: 'GET',
      path: '/api/issues',
      query: z.object({ month, reason: z.enum(ISSUE_REASONS).optional() }),
      metadata: staff,
      responses: { 200: z.array(issueSummary), ...commonErrors },
    },
    getIssue: {
      method: 'GET',
      path: '/api/issues/:id',
      pathParams: id,
      metadata: staff,
      responses: { 200: issueDetail, ...commonErrors },
    },
    createIssue: {
      method: 'POST',
      path: '/api/issues',
      body: issueInput,
      metadata: staff,
      responses: { 201: issueDetail, ...commonErrors },
    },
    deleteIssue: {
      method: 'DELETE',
      path: '/api/issues/:id',
      pathParams: id,
      body: z.object({ reason }),
      metadata: staff,
      responses: { 200: z.object({ ok: z.literal(true) }), ...commonErrors },
    },

    stock: {
      method: 'GET',
      path: '/api/inventory',
      metadata: staff,
      responses: { 200: z.array(stockRow), ...commonErrors },
    },
    lots: {
      method: 'GET',
      path: '/api/inventory/lots',
      query: z.object({ ingredientId: z.coerce.number().int(), open: z.enum(['true', 'false']).optional() }),
      metadata: staff,
      responses: { 200: z.array(lotRow), ...commonErrors },
    },
    pending: {
      method: 'GET',
      path: '/api/inventory/pending',
      metadata: staff,
      responses: {
        200: z.array(
          z.object({
            issueItemId: z.number(),
            issueId: z.number(),
            date: isoDate,
            reason: z.enum(ISSUE_REASONS),
            orderId: z.number().nullable(),
            ingredientId: z.number(),
            ingredientName: z.string(),
            unit: z.string(),
            pendingQty: decimalString,
            pendingUnitPrice: decimalString.nullable(),
          }),
        ),
        ...commonErrors,
      },
    },
    priceHistory: {
      method: 'GET',
      path: '/api/inventory/price-history',
      query: z.object({ ingredientId: z.coerce.number().int() }),
      metadata: staff,
      responses: {
        200: z.array(
          z.object({
            receiptId: z.number(),
            date: isoDate,
            supplier: z.string().nullable(),
            qty: decimalString,
            unitPrice: decimalString,
          }),
        ),
        ...commonErrors,
      },
    },
  },
  { strictStatusCodes: true },
);
