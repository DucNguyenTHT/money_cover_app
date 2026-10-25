import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { POINT_KINDS } from '../domain/enums';
import { commonErrors, decimalString, isoDate, reason, type RouteMeta } from './common';

const c = initContract();
const sellers = { roles: ['ADMIN', 'STAFF'] } satisfies RouteMeta;
const admin = { roles: ['ADMIN'] } satisfies RouteMeta;
const id = z.object({ id: z.coerce.number().int() });

export const customerSchema = z.object({
  id: z.number(),
  phone: z.string(),
  name: z.string(),
  birthday: isoDate.nullable(),
  note: z.string().nullable(),
  points: z.number(),
  visits: z.number(),
  totalSpent: decimalString,
  lastVisitAt: z.string().nullable(),
  active: z.boolean(),
  createdAt: z.string(),
});
export type CustomerDto = z.infer<typeof customerSchema>;

export const customerInput = z.object({
  phone: z.string().trim().min(8, 'Nhập số điện thoại').max(20),
  name: z.string().trim().min(1, 'Nhập tên khách').max(100),
  birthday: isoDate.nullable().optional(),
  note: z.string().trim().max(300).nullable().optional(),
});

export const pointEntrySchema = z.object({
  id: z.number(),
  kind: z.enum(POINT_KINDS),
  points: z.number(),
  orderId: z.number().nullable(),
  orderCode: z.string().nullable(),
  note: z.string().nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
});

export const customersContract = c.router(
  {
    list: {
      method: 'GET',
      path: '/api/customers',
      query: z.object({
        q: z.string().trim().max(50).optional(),
        sort: z.enum(['RECENT', 'SPENT', 'POINTS', 'NAME']).default('RECENT'),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      }),
      metadata: sellers,
      responses: { 200: z.array(customerSchema), ...commonErrors },
      summary: 'Tìm khách quen theo số điện thoại / tên',
    },
    get: {
      method: 'GET',
      path: '/api/customers/:id',
      pathParams: id,
      metadata: sellers,
      responses: {
        200: z.object({
          customer: customerSchema,
          entries: z.array(pointEntrySchema),
          orders: z.array(
            z.object({
              id: z.number(),
              code: z.string(),
              businessDate: isoDate,
              status: z.string(),
              total: decimalString,
              pointsEarned: z.number(),
              pointsRedeemed: z.number(),
            }),
          ),
        }),
        ...commonErrors,
      },
    },
    create: {
      method: 'POST',
      path: '/api/customers',
      body: customerInput,
      metadata: sellers,
      responses: { 201: customerSchema, ...commonErrors },
    },
    update: {
      method: 'PUT',
      path: '/api/customers/:id',
      pathParams: id,
      body: customerInput.extend({ active: z.boolean().optional() }),
      metadata: sellers,
      responses: { 200: customerSchema, ...commonErrors },
    },
    adjustPoints: {
      method: 'POST',
      path: '/api/customers/:id/points',
      pathParams: id,
      body: z.object({
        points: z
          .number()
          .int()
          .refine((v) => v !== 0, 'Nhập số điểm khác 0'),
        reason,
      }),
      metadata: admin,
      responses: { 200: customerSchema, ...commonErrors },
      summary: 'Cộng / trừ điểm tay (có lý do)',
    },
  },
  { strictStatusCodes: true },
);
