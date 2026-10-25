import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { EINVOICE_KINDS, EINVOICE_PROVIDERS, EINVOICE_STATUSES } from '../domain/enums';
import { commonErrors, decimalString, isoDate, type RouteMeta } from './common';

const c = initContract();
const admin = { roles: ['ADMIN'] } satisfies RouteMeta;
const sellers = { roles: ['ADMIN', 'STAFF'] } satisfies RouteMeta;

const text = (max: number) => z.string().trim().max(max).nullable().optional();

/** A company / person asking for an invoice in their name (all empty = retail customer). */
export const buyerSchema = z.object({
  name: text(200),
  taxCode: text(20),
  address: text(300),
  email: text(120),
});
export type BuyerDto = z.infer<typeof buyerSchema>;

export const einvoiceConfigSchema = z.object({
  provider: z.enum(EINVOICE_PROVIDERS).nullable(),
  configured: z.boolean(),
  enabled: z.boolean(),
  /** AUTO = every paid order gets an invoice; MANUAL = only when the cashier asks for one. */
  mode: z.enum(['AUTO', 'MANUAL']),
  sandbox: z.boolean(),
  clientId: z.string().nullable(),
  /** A secret was saved (it is sealed and never sent back). */
  hasSecret: z.boolean(),
  providerAccountId: z.string().nullable(),
  templateCode: z.string().nullable(),
  invoiceSeries: z.string().nullable(),
  lastOkAt: z.string().nullable(),
  lastError: z.string().nullable(),
});
export type EInvoiceConfig = z.infer<typeof einvoiceConfigSchema>;

export const einvoiceSchema = z.object({
  id: z.number(),
  orderId: z.number(),
  orderCode: z.string(),
  kind: z.enum(EINVOICE_KINDS),
  provider: z.enum(EINVOICE_PROVIDERS),
  status: z.enum(EINVOICE_STATUSES),
  invoiceNo: z.string().nullable(),
  series: z.string().nullable(),
  lookupUrl: z.string().nullable(),
  lookupCode: z.string().nullable(),
  amount: decimalString,
  buyer: buyerSchema.nullable(),
  attempts: z.number(),
  lastError: z.string().nullable(),
  issuedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type EInvoiceDto = z.infer<typeof einvoiceSchema>;

/** The invoice of an order, as the till and the bill show it. */
export const orderEInvoiceSchema = einvoiceSchema
  .pick({
    id: true,
    provider: true,
    status: true,
    invoiceNo: true,
    series: true,
    lookupUrl: true,
    lookupCode: true,
    lastError: true,
  })
  .extend({
    /** The sale was cancelled after issuing: an adjustment invoice exists (its status). */
    adjustment: z.enum(EINVOICE_STATUSES).nullable(),
  });
export type OrderEInvoice = z.infer<typeof orderEInvoiceSchema>;

export const providerAccountSchema = z.object({
  id: z.string(),
  provider: z.string(),
  active: z.boolean(),
  templates: z.array(z.object({ templateCode: z.string(), invoiceSeries: z.string(), label: z.string() })),
});

const credentials = z.object({
  provider: z.enum(EINVOICE_PROVIDERS),
  sandbox: z.boolean().default(false),
  clientId: z.string().trim().max(200).nullable().optional(),
  /** Omitted = keep the saved secret (same provider). */
  clientSecret: z.string().trim().max(300).optional(),
});

export const einvoiceContract = c.router(
  {
    config: {
      method: 'GET',
      path: '/api/einvoices/config',
      metadata: admin,
      responses: { 200: einvoiceConfigSchema, ...commonErrors },
      summary: 'Nhà cung cấp hoá đơn điện tử đang dùng',
    },
    posInfo: {
      method: 'GET',
      path: '/api/einvoices/pos',
      metadata: sellers,
      responses: {
        200: z.object({
          enabled: z.boolean(),
          mode: z.enum(['AUTO', 'MANUAL']),
          provider: z.enum(EINVOICE_PROVIDERS).nullable(),
        }),
        ...commonErrors,
      },
    },
    saveConfig: {
      method: 'PUT',
      path: '/api/einvoices/config',
      body: credentials.extend({
        enabled: z.boolean(),
        mode: z.enum(['AUTO', 'MANUAL']),
        providerAccountId: z.string().trim().max(100).nullable(),
        templateCode: z.string().trim().max(20).nullable(),
        invoiceSeries: z.string().trim().max(20).nullable(),
      }),
      metadata: admin,
      responses: { 200: einvoiceConfigSchema, ...commonErrors },
      summary: 'Lưu cấu hình (kiểm tra với nhà cung cấp trước khi bật)',
    },
    clear: {
      method: 'DELETE',
      path: '/api/einvoices/config',
      body: z.object({}),
      metadata: admin,
      responses: { 200: einvoiceConfigSchema, ...commonErrors },
    },
    accounts: {
      method: 'POST',
      path: '/api/einvoices/accounts',
      body: credentials,
      metadata: admin,
      responses: { 200: z.array(providerAccountSchema), ...commonErrors },
      summary: 'Tài khoản và mẫu / ký hiệu hoá đơn đã đăng ký ở nhà cung cấp',
    },
    list: {
      method: 'GET',
      path: '/api/einvoices',
      query: z.object({
        from: isoDate,
        to: isoDate,
        status: z.enum(EINVOICE_STATUSES).optional(),
      }),
      metadata: admin,
      responses: {
        200: z.object({
          rows: z.array(einvoiceSchema),
          counts: z.record(z.enum(EINVOICE_STATUSES), z.number()),
        }),
        ...commonErrors,
      },
    },
    issueForOrder: {
      method: 'POST',
      path: '/api/einvoices/orders/:orderId',
      pathParams: z.object({ orderId: z.coerce.number().int() }),
      body: z.object({ buyer: buyerSchema.optional() }),
      metadata: sellers,
      responses: { 200: einvoiceSchema, ...commonErrors },
      summary: 'Xuất hoá đơn cho một đơn đã thanh toán (chưa có, hoặc gửi lại lần lỗi)',
    },
    retry: {
      method: 'POST',
      path: '/api/einvoices/:id/retry',
      pathParams: z.object({ id: z.coerce.number().int() }),
      body: z.object({}),
      metadata: sellers,
      responses: { 200: einvoiceSchema, ...commonErrors },
    },
    process: {
      method: 'POST',
      path: '/api/einvoices/process',
      body: z.object({}),
      metadata: admin,
      responses: { 200: z.object({ done: z.number(), waiting: z.number() }), ...commonErrors },
      summary: 'Gửi ngay các hoá đơn đang chờ',
    },
  },
  { strictStatusCodes: true },
);
