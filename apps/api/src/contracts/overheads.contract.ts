import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { commonErrors, decimalString, type RouteMeta } from './common';

const c = initContract();
const admin = { roles: ['ADMIN'] } satisfies RouteMeta;

export const OVERHEAD_CATEGORIES = [
  'Mặt bằng',
  'Lương',
  'Điện',
  'Nước',
  'Gas',
  'Internet & phần mềm',
  'Sửa chữa',
  'Khác',
] as const;

export const overheadLine = z.object({
  category: z.string().trim().min(1).max(60),
  amount: decimalString.refine((v) => Number(v) >= 0, 'Không được âm'),
  note: z.string().trim().max(200).nullable(),
});

export const overheadMonth = z.object({
  year: z.number(),
  month: z.number(),
  lines: z.array(overheadLine),
  total: decimalString,
  locked: z.boolean(),
});
export type OverheadMonth = z.infer<typeof overheadMonth>;

export const overheadsContract = c.router(
  {
    year: {
      method: 'GET',
      path: '/api/overheads',
      query: z.object({ year: z.coerce.number().int().min(2000).max(2100) }),
      responses: { 200: z.array(overheadMonth), ...commonErrors },
      metadata: admin,
    },
    saveMonth: {
      method: 'PUT',
      path: '/api/overheads/:year/:month',
      pathParams: z.object({ year: z.coerce.number().int(), month: z.coerce.number().int().min(1).max(12) }),
      body: z.object({ lines: z.array(overheadLine) }),
      responses: { 200: overheadMonth, ...commonErrors },
      metadata: admin,
    },
  },
  { strictStatusCodes: true },
);
