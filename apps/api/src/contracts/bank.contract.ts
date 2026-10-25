import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { BANK_PROVIDERS, MATCH_KINDS, ORDER_STATUSES } from '../domain/enums';
import { commonErrors, decimalString, isoDate, reason, type RouteMeta } from './common';

const c = initContract();
const admin = { roles: ['ADMIN'] } satisfies RouteMeta;
const sellers = { roles: ['ADMIN', 'STAFF'] } satisfies RouteMeta;
const id = z.object({ id: z.coerce.number().int() });

export const bankFeedStatus = z.object({
  provider: z.enum(BANK_PROVIDERS).nullable(),
  /** A key was entered (it is sealed on the server and never sent back). */
  configured: z.boolean(),
  enabled: z.boolean(),
  /** SePay only: simulated environment. */
  sandbox: z.boolean(),
  /** Only transactions of this account are read (empty = every account linked to the service). */
  accountNo: z.string().nullable(),
  lastSyncAt: z.string().nullable(),
  lastOkAt: z.string().nullable(),
  lastError: z.string().nullable(),
});
export type BankFeedStatus = z.infer<typeof bankFeedStatus>;

export const bankTxnSchema = z.object({
  id: z.number(),
  provider: z.enum(BANK_PROVIDERS),
  amount: decimalString,
  description: z.string(),
  reference: z.string().nullable(),
  bankName: z.string().nullable(),
  accountNo: z.string().nullable(),
  transactedAt: z.string(),
  businessDate: isoDate,
  orderId: z.number().nullable(),
  orderCode: z.string().nullable(),
  orderStatus: z.enum(ORDER_STATUSES).nullable(),
  matchKind: z.enum(MATCH_KINDS).nullable(),
  matchedByName: z.string().nullable(),
  ignored: z.boolean(),
  ignoreReason: z.string().nullable(),
  ignoredByName: z.string().nullable(),
});
export type BankTxnDto = z.infer<typeof bankTxnSchema>;

/** A paid order whose transfers do not match what the bank shows (or a cancelled order that got money). */
export const transferOrderSchema = z.object({
  orderId: z.number(),
  code: z.string(),
  businessDate: isoDate,
  status: z.enum(ORDER_STATUSES),
  /** Transfer payments recorded at the till. */
  expected: decimalString,
  /** Money matched to the order on the bank account. */
  received: decimalString,
  check: z.enum(['OK', 'SHORT', 'OVER']),
});
export type TransferOrderDto = z.infer<typeof transferOrderSchema>;

/** Day closing: transfers of the day checked against the bank (null when no bank feed is used). */
export const dayTransferSchema = z
  .object({
    expected: decimalString,
    received: decimalString,
    /** Orders with less money on the bank than recorded. */
    short: z.number(),
    orders: z.array(transferOrderSchema),
    /** Money received that day and not tied to an order yet. */
    unmatched: z.array(bankTxnSchema),
  })
  .nullable();
export type DayTransfer = z.infer<typeof dayTransferSchema>;

export const bankContract = c.router(
  {
    status: {
      method: 'GET',
      path: '/api/bank',
      metadata: admin,
      responses: { 200: bankFeedStatus, ...commonErrors },
      summary: 'Kết nối dịch vụ báo số dư (SePay / Casso)',
    },
    saveConfig: {
      method: 'PUT',
      path: '/api/bank',
      body: z.object({
        provider: z.enum(BANK_PROVIDERS),
        /** Omitted = keep the key already saved (same provider). */
        token: z.string().trim().min(10, 'Mã API quá ngắn').max(300).optional(),
        sandbox: z.boolean().default(false),
        accountNo: z
          .string()
          .trim()
          .regex(/^[0-9A-Za-z]{0,19}$/, 'Số tài khoản không hợp lệ')
          .nullable(),
        enabled: z.boolean(),
      }),
      metadata: admin,
      responses: { 200: bankFeedStatus, ...commonErrors },
      summary: 'Lưu mã API (kiểm tra với dịch vụ trước khi lưu)',
    },
    clear: {
      method: 'DELETE',
      path: '/api/bank',
      body: z.object({}),
      metadata: admin,
      responses: { 200: bankFeedStatus, ...commonErrors },
    },
    sync: {
      method: 'POST',
      path: '/api/bank/sync',
      body: z.object({}),
      metadata: sellers,
      responses: { 200: z.object({ imported: z.number(), matched: z.number() }), ...commonErrors },
      summary: 'Đọc ngay giao dịch mới và khớp với đơn',
    },
    watch: {
      method: 'POST',
      path: '/api/bank/watch',
      body: z.object({
        orderId: z.number().int(),
        /** Amount the till waits for; null = stop waiting. */
        amount: decimalString.nullable(),
      }),
      metadata: sellers,
      responses: {
        200: z.object({ enabled: z.boolean(), received: decimalString }),
        ...commonErrors,
      },
      summary: 'Máy POS đang chờ tiền chuyển khoản của đơn này (đọc giao dịch dày hơn trong 3 phút)',
    },
    list: {
      method: 'GET',
      path: '/api/bank/transactions',
      query: z.object({
        from: isoDate,
        to: isoDate,
        filter: z.enum(['ALL', 'UNMATCHED', 'MATCHED', 'IGNORED']).default('ALL'),
      }),
      metadata: sellers,
      responses: {
        200: z.object({
          rows: z.array(bankTxnSchema),
          totals: z.object({
            received: decimalString,
            matched: decimalString,
            unmatched: decimalString,
            ignored: decimalString,
          }),
        }),
        ...commonErrors,
      },
    },
    unverified: {
      method: 'GET',
      path: '/api/bank/unverified',
      query: z.object({ from: isoDate, to: isoDate }),
      metadata: sellers,
      responses: { 200: z.array(transferOrderSchema), ...commonErrors },
      summary: 'Đơn trả chuyển khoản mà tiền về chưa khớp',
    },
    match: {
      method: 'POST',
      path: '/api/bank/transactions/:id/match',
      pathParams: id,
      body: z.object({ orderCode: z.string().trim().min(3).max(20) }),
      metadata: sellers,
      responses: { 200: bankTxnSchema, ...commonErrors },
      summary: 'Gán khoản tiền về cho một đơn',
    },
    unmatch: {
      method: 'POST',
      path: '/api/bank/transactions/:id/unmatch',
      pathParams: id,
      body: z.object({ reason }),
      metadata: admin,
      responses: { 200: bankTxnSchema, ...commonErrors },
    },
    ignore: {
      method: 'POST',
      path: '/api/bank/transactions/:id/ignore',
      pathParams: id,
      body: z.object({ reason }),
      metadata: admin,
      responses: { 200: bankTxnSchema, ...commonErrors },
      summary: 'Không phải tiền bán hàng (chủ quán tự chuyển, nhà cung cấp hoàn tiền…)',
    },
    unignore: {
      method: 'POST',
      path: '/api/bank/transactions/:id/unignore',
      pathParams: id,
      body: z.object({}),
      metadata: admin,
      responses: { 200: bankTxnSchema, ...commonErrors },
    },
  },
  { strictStatusCodes: true },
);
