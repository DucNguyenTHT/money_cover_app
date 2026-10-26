import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { DEPOSIT_OUTCOMES, RESERVATION_STATUSES } from '../domain/enums';
import { commonErrors, decimalString, isoDate, reason, type RouteMeta } from './common';

const c = initContract();
const sellers = { roles: ['ADMIN', 'STAFF'] } satisfies RouteMeta;
const id = z.object({ id: z.coerce.number().int() });

export const reservationInput = z.object({
  name: z.string().trim().min(1, 'Nhập tên khách').max(100),
  phone: z.string().trim().max(20).nullable(),
  guests: z.number().int().min(1).max(500),
  /** ISO instant. */
  reservedAt: z.string().datetime({ offset: true }),
  durationMin: z
    .number()
    .int()
    .min(15)
    .max(24 * 60),
  tableId: z.number().int().nullable(),
  note: z.string().trim().max(300).nullable(),
  deposit: decimalString,
  depositMethod: z.enum(['CASH', 'TRANSFER']).nullable(),
});

export const reservationSchema = z.object({
  id: z.number(),
  name: z.string(),
  phone: z.string().nullable(),
  customerId: z.number().nullable(),
  customerName: z.string().nullable(),
  guests: z.number(),
  reservedAt: z.string(),
  businessDate: isoDate,
  durationMin: z.number(),
  tableId: z.number().nullable(),
  tableName: z.string().nullable(),
  note: z.string().nullable(),
  deposit: decimalString,
  depositMethod: z.enum(['CASH', 'TRANSFER']).nullable(),
  depositOutcome: z.enum(DEPOSIT_OUTCOMES).nullable(),
  status: z.enum(RESERVATION_STATUSES),
  orderId: z.number().nullable(),
  orderCode: z.string().nullable(),
  cancelReason: z.string().nullable(),
  createdByName: z.string(),
  createdAt: z.string(),
});
export type ReservationDto = z.infer<typeof reservationSchema>;

export const reservationsContract = c.router(
  {
    list: {
      method: 'GET',
      path: '/api/reservations',
      query: z.object({ from: isoDate, to: isoDate }),
      metadata: sellers,
      responses: { 200: z.array(reservationSchema), ...commonErrors },
      summary: 'Đặt bàn theo ngày kinh doanh của giờ đến',
    },
    create: {
      method: 'POST',
      path: '/api/reservations',
      body: reservationInput,
      metadata: sellers,
      responses: { 201: reservationSchema, ...commonErrors },
      summary: 'Đặt bàn (cọc tiền mặt tự ghi thu vào sổ quỹ hôm nay)',
    },
    update: {
      method: 'PUT',
      path: '/api/reservations/:id',
      pathParams: id,
      body: reservationInput,
      metadata: sellers,
      responses: { 200: reservationSchema, ...commonErrors },
    },
    cancel: {
      method: 'POST',
      path: '/api/reservations/:id/cancel',
      pathParams: id,
      body: z.object({
        status: z.enum(['CANCELLED', 'NO_SHOW']),
        reason,
        /** With a deposit: give it back (cash: written out of the till) or keep it. */
        refund: z.boolean(),
      }),
      metadata: sellers,
      responses: { 200: reservationSchema, ...commonErrors },
      summary: 'Huỷ đặt bàn / khách không đến (hoàn hoặc giữ cọc)',
    },
  },
  { strictStatusCodes: true },
);
