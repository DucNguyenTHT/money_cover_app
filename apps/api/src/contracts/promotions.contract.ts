import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { CHANNELS, PROMOTION_KINDS } from '../domain/enums';
import { commonErrors, decimalString, isoDate, type RouteMeta } from './common';

const c = initContract();
const admin = { roles: ['ADMIN'] } satisfies RouteMeta;
const id = z.object({ id: z.coerce.number().int() });
const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Giờ dạng HH:MM')
  .nullable();

export const promotionInput = z.object({
  name: z.string().trim().min(1, 'Nhập tên khuyến mãi').max(100),
  kind: z.enum(PROMOTION_KINDS),
  active: z.boolean(),
  startDate: isoDate.nullable(),
  endDate: isoDate.nullable(),
  weekdays: z.array(z.number().int().min(1).max(7)).max(7),
  startTime: hhmm,
  endTime: hhmm,
  channels: z.array(z.enum(CHANNELS)).max(3),
  percent: decimalString.nullable(),
  comboPrice: decimalString.nullable(),
  items: z
    .array(
      z.object({
        dishId: z.number().int().nullable(),
        categoryId: z.number().int().nullable(),
        qty: z.number().int().min(1).max(99),
      }),
    )
    .max(50),
});

export const promotionSchema = promotionInput.extend({
  id: z.number(),
  items: z.array(
    z.object({
      dishId: z.number().nullable(),
      categoryId: z.number().nullable(),
      qty: z.number(),
      name: z.string(),
    }),
  ),
  status: z.enum(['OFF', 'UPCOMING', 'RUNNING', 'ENDED']),
  /** Paid orders this month that got it, and the money off. */
  monthOrders: z.number(),
  monthAmount: decimalString,
});
export type PromotionDto = z.infer<typeof promotionSchema>;

export const promotionsContract = c.router(
  {
    list: {
      method: 'GET',
      path: '/api/promotions',
      metadata: admin,
      responses: { 200: z.array(promotionSchema), ...commonErrors },
      summary: 'Khuyến mãi (giờ vàng, combo) và số tiền đã giảm tháng này',
    },
    create: {
      method: 'POST',
      path: '/api/promotions',
      body: promotionInput,
      metadata: admin,
      responses: { 201: promotionSchema, ...commonErrors },
    },
    update: {
      method: 'PUT',
      path: '/api/promotions/:id',
      pathParams: id,
      body: promotionInput,
      metadata: admin,
      responses: { 200: promotionSchema, ...commonErrors },
    },
    remove: {
      method: 'DELETE',
      path: '/api/promotions/:id',
      pathParams: id,
      body: z.object({}),
      metadata: admin,
      responses: { 200: z.object({ ok: z.literal(true) }), ...commonErrors },
      summary: 'Xoá khuyến mãi chưa dùng (đã dùng thì tắt)',
    },
  },
  { strictStatusCodes: true },
);
