import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { commonErrors, decimalString, isoDate, reason, type RouteMeta } from './common';

const c = initContract();
const sellers = { roles: ['ADMIN', 'STAFF'] } satisfies RouteMeta;
const admin = { roles: ['ADMIN'] } satisfies RouteMeta;
const qty = decimalString.refine((v) => Number(v) > 0, 'Số lượng phải lớn hơn 0');
const month = z.string().regex(/^\d{4}-\d{2}$/);

export const semiRecipeSchema = z.object({
  id: z.number(),
  effectiveFrom: isoDate,
  /** Output of one batch, in the semi-finished good's stock unit. */
  yieldQty: decimalString,
  note: z.string().nullable(),
  items: z.array(
    z.object({ ingredientId: z.number(), name: z.string(), unit: z.string(), qty: decimalString }),
  ),
});
export type SemiRecipeDto = z.infer<typeof semiRecipeSchema>;

export const semiSchema = z.object({
  ingredientId: z.number(),
  code: z.string(),
  name: z.string(),
  unit: z.string(),
  /** Recipe in force today (null = none yet). */
  recipe: semiRecipeSchema.nullable(),
  /** Cost of one unit from the recipe at the latest input prices (null when a price is missing). */
  theoreticalUnitCost: decimalString.nullable().optional(),
  /** Unit cost of the last batch cooked. */
  lastUnitCost: decimalString.nullable().optional(),
  onHand: decimalString,
});
export type SemiDto = z.infer<typeof semiSchema>;

export const productionSchema = z.object({
  id: z.number(),
  date: isoDate,
  ingredientId: z.number(),
  name: z.string(),
  unit: z.string(),
  qty: decimalString,
  /** Cost fields are left out for staff. */
  costTotal: decimalString.optional(),
  unitCost: decimalString.optional(),
  note: z.string().nullable(),
  createdBy: z.string(),
  /** Some of the batch has been used (sold / counted): it cannot be deleted any more. */
  used: z.boolean(),
  locked: z.boolean(),
  inputs: z.array(
    z.object({
      ingredientId: z.number(),
      name: z.string(),
      unit: z.string(),
      qty: decimalString,
      cost: decimalString.optional(),
    }),
  ),
});
export type ProductionDto = z.infer<typeof productionSchema>;

const line = z.object({ ingredientId: z.number().int(), qty });

export const productionContract = c.router(
  {
    semis: {
      method: 'GET',
      path: '/api/semis',
      metadata: sellers,
      responses: { 200: z.array(semiSchema), ...commonErrors },
      summary: 'Bán thành phẩm, công thức đang dùng và giá vốn',
    },
    recipes: {
      method: 'GET',
      path: '/api/semis/:id/recipes',
      pathParams: z.object({ id: z.coerce.number().int() }),
      metadata: sellers,
      responses: { 200: z.array(semiRecipeSchema), ...commonErrors },
    },
    saveRecipe: {
      method: 'PUT',
      path: '/api/semis/:id/recipes',
      pathParams: z.object({ id: z.coerce.number().int() }),
      body: z.object({
        effectiveFrom: isoDate,
        yieldQty: qty,
        note: z.string().trim().max(200).nullable(),
        items: z.array(line).min(1, 'Thêm ít nhất một nguyên liệu'),
      }),
      metadata: admin,
      responses: { 200: semiRecipeSchema, ...commonErrors },
      summary: 'Lưu công thức chế biến (cùng ngày hiệu lực thì thay)',
    },
    list: {
      method: 'GET',
      path: '/api/productions',
      query: z.object({ month }),
      metadata: sellers,
      responses: { 200: z.array(productionSchema), ...commonErrors },
    },
    plan: {
      method: 'POST',
      path: '/api/productions/plan',
      body: z.object({ ingredientId: z.number().int(), qty, date: isoDate }),
      metadata: sellers,
      responses: {
        200: z.object({
          inputs: z.array(
            z.object({ ingredientId: z.number(), name: z.string(), unit: z.string(), qty: decimalString }),
          ),
          /** Estimated cost at the latest prices (the real one is FIFO at saving). */
          estimatedCost: decimalString.nullable().optional(),
        }),
        ...commonErrors,
      },
      summary: 'Nguyên liệu gợi ý cho một mẻ theo công thức',
    },
    create: {
      method: 'POST',
      path: '/api/productions',
      body: z.object({
        date: isoDate,
        ingredientId: z.number().int(),
        qty,
        note: z.string().trim().max(200).nullable(),
        inputs: z.array(line).min(1, 'Nhập nguyên liệu dùng để chế biến'),
      }),
      metadata: sellers,
      responses: { 201: productionSchema, ...commonErrors },
    },
    remove: {
      method: 'DELETE',
      path: '/api/productions/:id',
      pathParams: z.object({ id: z.coerce.number().int() }),
      body: z.object({ reason }),
      metadata: sellers,
      responses: { 200: z.object({ ok: z.literal(true) }), ...commonErrors },
      summary: 'Xoá phiếu chế biến (chưa dùng tới mẻ đó): hoàn nguyên liệu',
    },
  },
  { strictStatusCodes: true },
);
