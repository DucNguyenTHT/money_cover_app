import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { CASH_DIRECTIONS } from '../domain/enums';
import { commonErrors, decimalString, isoDate, reason, type RouteMeta } from './common';

const c = initContract();
const sellers = { roles: ['ADMIN', 'STAFF'] } satisfies RouteMeta;
const money = decimalString.refine((v) => Number(v) > 0, 'Số tiền phải lớn hơn 0');

export const cashEntrySchema = z.object({
  id: z.number(),
  businessDate: isoDate,
  direction: z.enum(CASH_DIRECTIONS),
  category: z.string(),
  amount: decimalString,
  note: z.string().nullable(),
  /** Made by another screen (SUPPLIER_PAYMENT / PAYROLL): cancelled there, not here. */
  source: z.string().nullable(),
  createdById: z.number(),
  createdByName: z.string(),
  createdAt: z.string(),
  cancelled: z.boolean(),
  cancelReason: z.string().nullable(),
  cancelledByName: z.string().nullable(),
});
export type CashEntryDto = z.infer<typeof cashEntrySchema>;

export const cashInput = z.object({
  businessDate: isoDate,
  direction: z.enum(CASH_DIRECTIONS),
  category: z.string().trim().min(1, 'Chọn hoặc nhập khoản mục').max(60),
  amount: money,
  note: z.string().trim().max(200).nullable(),
});

export const cashContract = c.router(
  {
    list: {
      method: 'GET',
      path: '/api/cash',
      query: z.object({ from: isoDate, to: isoDate }),
      responses: {
        200: z.object({
          entries: z.array(cashEntrySchema),
          totalIn: decimalString,
          totalOut: decimalString,
        }),
        ...commonErrors,
      },
      metadata: sellers,
      summary: 'Sổ quỹ tiền mặt trong khoảng ngày',
    },
    create: {
      method: 'POST',
      path: '/api/cash',
      body: cashInput,
      responses: { 201: cashEntrySchema, ...commonErrors },
      metadata: sellers,
    },
    cancel: {
      method: 'POST',
      path: '/api/cash/:id/cancel',
      pathParams: z.object({ id: z.coerce.number().int() }),
      body: z.object({ reason }),
      responses: { 200: cashEntrySchema, ...commonErrors },
      metadata: sellers,
    },
  },
  { strictStatusCodes: true },
);
