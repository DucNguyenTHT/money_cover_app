import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { DOCUMENT_KINDS } from '../domain/enums';
import { commonErrors, decimalString, isoDate, reason, type RouteMeta } from './common';

const c = initContract();
const admin = { roles: ['ADMIN'] } satisfies RouteMeta;
const staff = { roles: ['ADMIN', 'STAFF'] } satisfies RouteMeta;
const id = z.object({ id: z.coerce.number().int() });
/** "YYYY-MM" (one month) or "YYYY" (whole year). */
export const documentPeriod = z.string().regex(/^\d{4}(-\d{2})?$/, 'Kỳ dạng YYYY hoặc YYYY-MM');
const period = documentPeriod;
/** Required unless the uploader changes their own item within 24 h (see domain/documents/permissions). */
const optionalReason = reason.optional();

export const DOCUMENT_KIND_LABELS: Record<(typeof DOCUMENT_KINDS)[number], string> = {
  PURCHASE: 'Mua vào',
  SALE: 'Bán ra',
  OTHER: 'Khác',
};

export const documentInput = z.object({
  kind: z.enum(DOCUMENT_KINDS),
  date: isoDate,
  number: z.string().trim().max(60).nullable(),
  partner: z.string().trim().max(120).nullable(),
  amount: decimalString.refine((v) => Number(v) >= 0, 'Không được âm').nullable(),
  note: z.string().trim().max(500).nullable(),
  receiptId: z.number().int().nullable(),
});
export type DocumentInput = z.infer<typeof documentInput>;

export const documentFile = z.object({
  id: z.number(),
  name: z.string(),
  mime: z.string(),
  size: z.number(),
  hasThumb: z.boolean(),
  createdAt: z.string(),
  createdBy: z.string(),
  createdById: z.number(),
});
export type DocumentFileDto = z.infer<typeof documentFile>;

export const documentSummary = z.object({
  id: z.number(),
  kind: z.enum(DOCUMENT_KINDS),
  date: isoDate,
  number: z.string().nullable(),
  partner: z.string().nullable(),
  amount: decimalString.nullable(),
  note: z.string().nullable(),
  receiptId: z.number().nullable(),
  fileCount: z.number(),
  /** Shown as the row thumbnail. */
  cover: documentFile.nullable(),
  createdBy: z.string(),
  createdById: z.number(),
  createdAt: z.string(),
  locked: z.boolean(),
});
export type DocumentSummary = z.infer<typeof documentSummary>;

export const documentDetail = documentSummary.extend({ files: z.array(documentFile) });
export type DocumentDetail = z.infer<typeof documentDetail>;

export const documentList = z.object({
  rows: z.array(documentSummary),
  totals: z.array(z.object({ kind: z.enum(DOCUMENT_KINDS), count: z.number(), amount: decimalString })),
  /** Documents in the period that have no file attached yet. */
  missingFiles: z.number(),
});
export type DocumentList = z.infer<typeof documentList>;

export const fileUpload = z.object({
  name: z.string().max(255),
  /** File bytes, base64. Images are compressed in the browser first; type is detected from the bytes. */
  dataBase64: z.string().min(1),
  /** Small JPEG preview made in the browser (images only). */
  thumbBase64: z.string().nullable(),
});
export type FileUpload = z.infer<typeof fileUpload>;

export const documentsContract = c.router(
  {
    list: {
      method: 'GET',
      path: '/api/documents',
      /** Give `period` or `receiptId`. */
      query: z.object({
        period: period.optional(),
        receiptId: z.coerce.number().int().optional(),
        kind: z.enum(DOCUMENT_KINDS).optional(),
        q: z.string().trim().max(100).optional(),
      }),
      metadata: staff,
      responses: { 200: documentList, ...commonErrors },
    },
    partners: {
      method: 'GET',
      path: '/api/documents/partners',
      metadata: staff,
      responses: { 200: z.array(z.string()), ...commonErrors },
    },
    get: {
      method: 'GET',
      path: '/api/documents/:id',
      pathParams: id,
      metadata: staff,
      responses: { 200: documentDetail, ...commonErrors },
    },
    create: {
      method: 'POST',
      path: '/api/documents',
      body: documentInput,
      metadata: staff,
      responses: { 201: documentDetail, ...commonErrors },
    },
    update: {
      method: 'PUT',
      path: '/api/documents/:id',
      pathParams: id,
      body: documentInput.extend({ reason: optionalReason }),
      metadata: staff,
      responses: { 200: documentDetail, ...commonErrors },
    },
    remove: {
      method: 'DELETE',
      path: '/api/documents/:id',
      pathParams: id,
      body: z.object({ reason: optionalReason }),
      metadata: staff,
      responses: { 200: z.object({ ok: z.literal(true) }), ...commonErrors },
    },
    addFile: {
      method: 'POST',
      path: '/api/documents/:id/files',
      pathParams: id,
      body: fileUpload,
      metadata: staff,
      responses: { 201: documentFile, ...commonErrors },
    },
    exportLink: {
      method: 'POST',
      path: '/api/documents/export-link',
      body: z.object({ period }),
      metadata: admin,
      responses: { 200: z.object({ url: z.string(), fileName: z.string() }), ...commonErrors },
    },
    removeFile: {
      method: 'DELETE',
      path: '/api/documents/:id/files/:fileId',
      pathParams: id.extend({ fileId: z.coerce.number().int() }),
      body: z.object({ reason: optionalReason }),
      metadata: staff,
      responses: { 200: z.object({ ok: z.literal(true) }), ...commonErrors },
    },
  },
  { strictStatusCodes: true },
);
