import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { TABLE_REQUEST_KINDS, TABLE_REQUEST_STATUSES } from '../domain/enums';
import { commonErrors, decimalString, reason, type RouteMeta } from './common';

const c = initContract();
const guest = { public: true } satisfies RouteMeta;
const sellers = { roles: ['ADMIN', 'STAFF'] } satisfies RouteMeta;
const admin = { roles: ['ADMIN'] } satisfies RouteMeta;
const token = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Mã bàn không hợp lệ') });
const clientId = z.string().regex(/^[A-Za-z0-9_-]{8,40}$/, 'Mã máy không hợp lệ');

const requestLine = z.object({
  dishId: z.number().int(),
  qty: z.number().int().min(1).max(20),
  optionIds: z.array(z.number().int()).max(20).default([]),
  note: z.string().trim().max(100).nullable().default(null),
});

/** What a guest's phone sees: the menu at the in-store price, without costs. */
export const guestMenuSchema = z.object({
  shopName: z.string(),
  tableName: z.string(),
  areaName: z.string(),
  categories: z.array(z.object({ id: z.number(), name: z.string() })),
  dishes: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      categoryId: z.number(),
      price: decimalString,
      soldOut: z.boolean(),
      groupIds: z.array(z.number()),
    }),
  ),
  groups: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      multi: z.boolean(),
      required: z.boolean(),
      maxSelect: z.number().nullable(),
      options: z.array(
        z.object({ id: z.number(), name: z.string(), price: decimalString, isDefault: z.boolean() }),
      ),
    }),
  ),
});
export type GuestMenu = z.infer<typeof guestMenuSchema>;

export const guestRequestSchema = z.object({
  id: z.number(),
  kind: z.enum(TABLE_REQUEST_KINDS),
  status: z.enum(TABLE_REQUEST_STATUSES),
  portions: z.number(),
  rejectReason: z.string().nullable(),
  createdAt: z.string(),
});
export type GuestRequest = z.infer<typeof guestRequestSchema>;

export const tableRequestSchema = z.object({
  id: z.number(),
  tableId: z.number(),
  tableName: z.string(),
  kind: z.enum(TABLE_REQUEST_KINDS),
  status: z.enum(TABLE_REQUEST_STATUSES),
  items: z.array(
    z.object({
      dishId: z.number(),
      name: z.string(),
      qty: z.number(),
      options: z.string(),
      note: z.string().nullable(),
    }),
  ),
  note: z.string().nullable(),
  orderId: z.number().nullable(),
  handledByName: z.string().nullable(),
  rejectReason: z.string().nullable(),
  createdAt: z.string(),
});
export type TableRequestDto = z.infer<typeof tableRequestSchema>;

/** Public routes used by the guest page (/t/:token), behind their own rate limit. */
export const guestContract = c.router(
  {
    menu: {
      method: 'GET',
      path: '/api/public/t/:token',
      pathParams: token,
      metadata: guest,
      responses: { 200: guestMenuSchema, ...commonErrors },
      summary: 'Thực đơn cho khách quét QR tại bàn (giá tại quán, không có giá vốn)',
    },
    send: {
      method: 'POST',
      path: '/api/public/t/:token/requests',
      pathParams: token,
      body: z.object({
        clientId,
        kind: z.enum(TABLE_REQUEST_KINDS),
        items: z.array(requestLine).max(30).default([]),
        note: z.string().trim().max(200).nullable().default(null),
      }),
      metadata: guest,
      responses: { 201: guestRequestSchema, ...commonErrors },
      summary: 'Khách gửi yêu cầu: gọi món / gọi nhân viên / xin thanh toán',
    },
    mine: {
      method: 'GET',
      path: '/api/public/t/:token/requests',
      pathParams: token,
      query: z.object({ clientId }),
      metadata: guest,
      responses: { 200: z.array(guestRequestSchema), ...commonErrors },
    },
  },
  { strictStatusCodes: true },
);

export const tableRequestsContract = c.router(
  {
    list: {
      method: 'GET',
      path: '/api/table-requests',
      metadata: sellers,
      responses: { 200: z.array(tableRequestSchema), ...commonErrors },
      summary: 'Yêu cầu từ bàn đang chờ (và vừa xử lý)',
    },
    accept: {
      method: 'POST',
      path: '/api/table-requests/:id/accept',
      pathParams: z.object({ id: z.coerce.number().int() }),
      body: z.object({}),
      metadata: sellers,
      responses: { 200: tableRequestSchema, ...commonErrors },
      summary: 'Nhận yêu cầu (gọi món: thêm vào đơn đang mở của bàn, chưa có thì mở đơn)',
    },
    reject: {
      method: 'POST',
      path: '/api/table-requests/:id/reject',
      pathParams: z.object({ id: z.coerce.number().int() }),
      body: z.object({ reason }),
      metadata: sellers,
      responses: { 200: tableRequestSchema, ...commonErrors },
    },
    qrCodes: {
      method: 'POST',
      path: '/api/tables/qr',
      body: z.object({ renewTableId: z.number().int().nullable().default(null) }),
      metadata: admin,
      responses: {
        200: z.array(
          z.object({ tableId: z.number(), tableName: z.string(), areaName: z.string(), token: z.string() }),
        ),
        ...commonErrors,
      },
      summary: 'Mã QR gọi món của các bàn (tạo cho bàn chưa có; đổi mã một bàn)',
    },
  },
  { strictStatusCodes: true },
);
