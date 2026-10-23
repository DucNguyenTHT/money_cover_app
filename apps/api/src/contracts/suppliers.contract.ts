import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { commonErrors, decimalString, isoDate, reason, type RouteMeta } from './common';

const c = initContract();
const admin = { roles: ['ADMIN'] } satisfies RouteMeta;
const sellers = { roles: ['ADMIN', 'STAFF'] } satisfies RouteMeta;
const id = z.object({ id: z.coerce.number().int() });

export const supplierInput = z.object({
  name: z.string().trim().min(1, 'Nhập tên nhà cung cấp').max(120),
  phone: z.string().trim().max(30).nullable(),
  address: z.string().trim().max(200).nullable(),
  note: z.string().trim().max(300).nullable(),
  active: z.boolean(),
});

export const supplierSchema = supplierInput.extend({
  id: z.number(),
  /** Purchase receipts total. */
  purchased: decimalString,
  /** Payments total (not cancelled). */
  paid: decimalString,
  /** purchased − paid: > 0 the shop owes, < 0 paid in advance. */
  balance: decimalString,
  receiptCount: z.number(),
  lastReceiptDate: isoDate.nullable(),
});
export type SupplierDto = z.infer<typeof supplierSchema>;

export const supplierPaymentInput = z.object({
  date: isoDate,
  amount: decimalString.refine((v) => Number(v) > 0, 'Số tiền phải lớn hơn 0'),
  method: z.enum(['CASH', 'TRANSFER']),
  /** Paying one receipt (optional). */
  receiptId: z.number().int().nullable(),
  note: z.string().trim().max(200).nullable(),
});

export const ledgerEntry = z.object({
  date: isoDate,
  kind: z.enum(['RECEIPT', 'PAYMENT']),
  /** Receipt code (PN000123) or payment method. */
  label: z.string(),
  receiptId: z.number().nullable(),
  paymentId: z.number().nullable(),
  /** Payments: CASH / TRANSFER / OPENING (paid before debts were tracked). */
  method: z.string().nullable(),
  /** + increases the debt (receipt), − decreases it (payment). */
  amount: decimalString,
  /** Receipt rows: what is still owed on that receipt (payments pay the oldest receipts first). */
  remaining: decimalString.nullable(),
  /** Debt after this line (cancelled payments do not count). */
  balance: decimalString,
  note: z.string().nullable(),
  cancelled: z.boolean(),
  cancelReason: z.string().nullable(),
});
export type LedgerEntry = z.infer<typeof ledgerEntry>;

export const suppliersContract = c.router(
  {
    list: {
      method: 'GET',
      path: '/api/suppliers',
      responses: { 200: z.array(supplierSchema), ...commonErrors },
      metadata: sellers,
      summary: 'Nhà cung cấp và công nợ',
    },
    create: {
      method: 'POST',
      path: '/api/suppliers',
      body: supplierInput,
      responses: { 201: supplierSchema, ...commonErrors },
      metadata: admin,
    },
    update: {
      method: 'PUT',
      path: '/api/suppliers/:id',
      pathParams: id,
      body: supplierInput,
      responses: { 200: supplierSchema, ...commonErrors },
      metadata: admin,
    },
    ledger: {
      method: 'GET',
      path: '/api/suppliers/:id/ledger',
      pathParams: id,
      responses: {
        200: z.object({ supplier: supplierSchema, entries: z.array(ledgerEntry) }),
        ...commonErrors,
      },
      metadata: sellers,
      summary: 'Sổ công nợ: phiếu nhập và các lần trả, số dư sau mỗi dòng',
    },
    pay: {
      method: 'POST',
      path: '/api/suppliers/:id/payments',
      pathParams: id,
      body: supplierPaymentInput,
      responses: { 201: supplierSchema, ...commonErrors },
      metadata: sellers,
      summary: 'Trả tiền nhà cung cấp (tiền mặt: tự ghi chi sổ quỹ)',
    },
    cancelPayment: {
      method: 'POST',
      path: '/api/supplier-payments/:id/cancel',
      pathParams: id,
      body: z.object({ reason }),
      responses: { 200: supplierSchema, ...commonErrors },
      metadata: admin,
    },
  },
  { strictStatusCodes: true },
);
