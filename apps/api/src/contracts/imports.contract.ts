import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { commonErrors, isoDate, type RouteMeta } from './common';

const c = initContract();
const admin = { roles: ['ADMIN'] } satisfies RouteMeta;

export const IMPORT_KINDS = ['ingredients', 'dishes', 'recipes', 'opening'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export const importRequest = z.object({
  /** The .xlsx file, base64-encoded. */
  fileBase64: z.string().min(1),
  /** Opening stock date / recipe effective date (defaults to today). */
  date: isoDate.optional(),
});

export const importPreview = z.object({
  total: z.number(),
  valid: z.number(),
  rows: z.array(
    z.object({
      row: z.number(),
      action: z.enum(['CREATE', 'UPDATE', 'ERROR']),
      label: z.string(),
      errors: z.array(z.string()),
    }),
  ),
});
export type ImportPreview = z.infer<typeof importPreview>;

const kind = z.object({ kind: z.enum(IMPORT_KINDS) });

export const importsContract = c.router(
  {
    preview: {
      method: 'POST',
      path: '/api/imports/:kind/preview',
      pathParams: kind,
      body: importRequest,
      responses: { 200: importPreview, ...commonErrors },
      metadata: admin,
    },
    commit: {
      method: 'POST',
      path: '/api/imports/:kind/commit',
      pathParams: kind,
      body: importRequest,
      responses: { 200: z.object({ created: z.number(), updated: z.number() }), ...commonErrors },
      metadata: admin,
      summary: 'Lưu tất cả dòng hợp lệ (có dòng lỗi thì không lưu gì)',
    },
  },
  { strictStatusCodes: true },
);
