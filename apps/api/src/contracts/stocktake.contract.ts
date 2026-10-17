import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { STOCKTAKE_STATUSES } from '../domain/enums';
import { commonErrors, decimalString, isoDate, reason, type RouteMeta } from './common';

const c = initContract();
const staff = { roles: ['ADMIN', 'STAFF'] } satisfies RouteMeta;
const admin = { roles: ['ADMIN'] } satisfies RouteMeta;
const id = z.object({ id: z.coerce.number().int() });

export const stocktakeSummary = z.object({
  id: z.number(),
  date: isoDate,
  status: z.enum(STOCKTAKE_STATUSES),
  note: z.string().nullable(),
  itemCount: z.number(),
  countedCount: z.number(),
  /** Shortage − surplus value (ADMIN only). */
  lossTotal: decimalString.optional(),
  createdByName: z.string(),
  completedAt: z.string().nullable(),
});
export type StocktakeSummary = z.infer<typeof stocktakeSummary>;

export const stocktakeItemSchema = z.object({
  ingredientId: z.number(),
  code: z.string(),
  name: z.string(),
  unit: z.string(),
  category: z.string().nullable(),
  bookQty: decimalString,
  actualQty: decimalString.nullable(),
  diffQty: decimalString.nullable(),
  /** Unsettled "nợ kho" right now — the book quantity is less certain. */
  pendingQty: decimalString,
  lossValue: decimalString.optional(),
});
export type StocktakeItemDto = z.infer<typeof stocktakeItemSchema>;

export const stocktakeDetail = stocktakeSummary.extend({
  items: z.array(stocktakeItemSchema),
  /** Loss spread over dishes (ADMIN, after completion). dishId null = hao hụt chung. */
  dishAllocations: z
    .array(z.object({ dishId: z.number().nullable(), dishName: z.string(), lossValue: decimalString }))
    .optional(),
  periodFrom: isoDate.nullable(),
});
export type StocktakeDetail = z.infer<typeof stocktakeDetail>;

const qty = decimalString.refine((v) => Number(v) >= 0, 'Số lượng không được âm');

export const stocktakeContract = c.router(
  {
    list: {
      method: 'GET',
      path: '/api/stocktakes',
      query: z.object({
        month: z
          .string()
          .regex(/^\d{4}-\d{2}$/)
          .optional(),
      }),
      responses: { 200: z.array(stocktakeSummary), ...commonErrors },
      metadata: staff,
    },
    get: {
      method: 'GET',
      path: '/api/stocktakes/:id',
      pathParams: id,
      responses: { 200: stocktakeDetail, ...commonErrors },
      metadata: staff,
    },
    create: {
      method: 'POST',
      path: '/api/stocktakes',
      body: z.object({ date: isoDate, note: z.string().trim().max(200).nullable() }),
      responses: { 201: stocktakeDetail, ...commonErrors },
      metadata: staff,
      summary: 'Tạo phiếu kiểm kê nháp: tồn sổ sách của mọi nguyên liệu tại ngày kiểm',
    },
    update: {
      method: 'PUT',
      path: '/api/stocktakes/:id',
      pathParams: id,
      body: z.object({
        note: z.string().trim().max(200).nullable(),
        items: z.array(z.object({ ingredientId: z.number().int(), actualQty: qty.nullable() })),
      }),
      responses: { 200: stocktakeDetail, ...commonErrors },
      metadata: staff,
      summary: 'Nhập tồn thực tế (phiếu nháp)',
    },
    complete: {
      method: 'POST',
      path: '/api/stocktakes/:id/complete',
      pathParams: id,
      body: z.object({}),
      responses: { 200: stocktakeDetail, ...commonErrors },
      metadata: admin,
      summary: 'Chốt: trừ lô thiếu (FIFO), tạo lô thừa, phân bổ hao hụt vào món',
    },
    cancel: {
      method: 'POST',
      path: '/api/stocktakes/:id/cancel',
      pathParams: id,
      body: z.object({ reason }),
      responses: { 200: stocktakeDetail, ...commonErrors },
      metadata: admin,
    },
  },
  { strictStatusCodes: true },
);
