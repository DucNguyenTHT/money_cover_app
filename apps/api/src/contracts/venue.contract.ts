// Floor plan (areas & tables), delivery apps and printers.
import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { PRINTER_ROLES } from '../domain/enums';
import { commonErrors, decimalString, type RouteMeta } from './common';

const c = initContract();
const admin = { roles: ['ADMIN'] } satisfies RouteMeta;
const id = z.object({ id: z.coerce.number().int() });

export const tableInput = z.object({
  areaId: z.number().int(),
  name: z.string().trim().min(1, 'Nhập tên bàn').max(30),
  seats: z.number().int().min(1).max(50),
  sort: z.number().int(),
  active: z.boolean(),
});
export const tableSchema = tableInput.extend({ id: z.number() });

export const areaInput = z.object({
  name: z.string().trim().min(1, 'Nhập tên khu vực').max(40),
  sort: z.number().int(),
});
export const areaSchema = areaInput.extend({ id: z.number(), tables: z.array(tableSchema) });
export type AreaDto = z.infer<typeof areaSchema>;
export type TableDto = z.infer<typeof tableSchema>;

export const deliveryAppInput = z.object({
  name: z.string().trim().min(1, 'Nhập tên app').max(40),
  commissionPct: decimalString.refine((v) => Number(v) >= 0 && Number(v) <= 60, 'Chiết khấu 0–60%'),
  active: z.boolean(),
});
export const deliveryAppSchema = deliveryAppInput.extend({ id: z.number() });
export type DeliveryAppDto = z.infer<typeof deliveryAppSchema>;

export const printerInput = z.object({
  name: z.string().trim().min(1, 'Nhập tên máy in').max(40),
  ip: z
    .string()
    .trim()
    .regex(/^(\d{1,3}\.){3}\d{1,3}$/, 'Địa chỉ IP dạng 192.168.1.50'),
  port: z.number().int().min(1).max(65535),
  paperWidth: z.union([z.literal(58), z.literal(80)]),
  role: z.enum(PRINTER_ROLES),
  active: z.boolean(),
});
export const printerSchema = printerInput.extend({ id: z.number() });
export type PrinterDto = z.infer<typeof printerSchema>;

export const venueContract = c.router(
  {
    listAreas: {
      method: 'GET',
      path: '/api/areas',
      responses: { 200: z.array(areaSchema), ...commonErrors },
    },
    createArea: {
      method: 'POST',
      path: '/api/areas',
      body: areaInput,
      responses: { 201: areaSchema, ...commonErrors },
      metadata: admin,
    },
    updateArea: {
      method: 'PUT',
      path: '/api/areas/:id',
      pathParams: id,
      body: areaInput,
      responses: { 200: areaSchema, ...commonErrors },
      metadata: admin,
    },
    createTable: {
      method: 'POST',
      path: '/api/tables',
      body: tableInput,
      responses: { 201: tableSchema, ...commonErrors },
      metadata: admin,
    },
    updateTable: {
      method: 'PUT',
      path: '/api/tables/:id',
      pathParams: id,
      body: tableInput,
      responses: { 200: tableSchema, ...commonErrors },
      metadata: admin,
    },

    listDeliveryApps: {
      method: 'GET',
      path: '/api/delivery-apps',
      responses: { 200: z.array(deliveryAppSchema), ...commonErrors },
    },
    createDeliveryApp: {
      method: 'POST',
      path: '/api/delivery-apps',
      body: deliveryAppInput,
      responses: { 201: deliveryAppSchema, ...commonErrors },
      metadata: admin,
    },
    updateDeliveryApp: {
      method: 'PUT',
      path: '/api/delivery-apps/:id',
      pathParams: id,
      body: deliveryAppInput,
      responses: { 200: deliveryAppSchema, ...commonErrors },
      metadata: admin,
    },

    listPrinters: {
      method: 'GET',
      path: '/api/printers',
      responses: { 200: z.array(printerSchema), ...commonErrors },
      metadata: admin,
    },
    createPrinter: {
      method: 'POST',
      path: '/api/printers',
      body: printerInput,
      responses: { 201: printerSchema, ...commonErrors },
      metadata: admin,
    },
    updatePrinter: {
      method: 'PUT',
      path: '/api/printers/:id',
      pathParams: id,
      body: printerInput,
      responses: { 200: printerSchema, ...commonErrors },
      metadata: admin,
    },
    testPrinter: {
      method: 'POST',
      path: '/api/printers/:id/test',
      pathParams: id,
      body: z.object({}).optional(),
      responses: { 200: z.object({ ok: z.literal(true) }), ...commonErrors },
      metadata: admin,
      summary: 'In thử một trang',
    },
  },
  { strictStatusCodes: true },
);
