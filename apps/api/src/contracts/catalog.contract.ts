import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { INGREDIENT_KINDS } from '../domain/enums';
import { commonErrors, decimalString, type RouteMeta } from './common';

const c = initContract();
const admin = { roles: ['ADMIN'] } satisfies RouteMeta;
const id = z.object({ id: z.coerce.number().int() });

const positive = decimalString.refine((v) => Number(v) > 0, 'Phải lớn hơn 0');

export const ingredientInput = z.object({
  code: z.string().trim().min(1, 'Nhập mã').max(30),
  name: z.string().trim().min(1, 'Nhập tên').max(120),
  kind: z.enum(INGREDIENT_KINDS),
  unit: z.string().trim().min(1, 'Nhập đơn vị kho').max(20),
  recipeUnit: z.string().trim().min(1, 'Nhập đơn vị định mức').max(20),
  recipeFactor: positive,
  purchaseUnit: z.string().trim().max(20).nullable(),
  purchaseFactor: positive,
  category: z.string().trim().max(60).nullable(),
  active: z.boolean(),
});
export const ingredientSchema = ingredientInput.extend({
  id: z.number(),
  /** Already has stock or is in a recipe: the stock unit, recipe unit and their factor can no longer change. */
  unitsLocked: z.boolean(),
});
export type IngredientDto = z.infer<typeof ingredientSchema>;

export const catalogContract = c.router(
  {
    listIngredients: {
      method: 'GET',
      path: '/api/ingredients',
      query: z.object({ q: z.string().optional(), active: z.enum(['true', 'false']).optional() }),
      responses: { 200: z.array(ingredientSchema), ...commonErrors },
    },
    createIngredient: {
      method: 'POST',
      path: '/api/ingredients',
      body: ingredientInput,
      responses: { 201: ingredientSchema, ...commonErrors },
      metadata: admin,
    },
    updateIngredient: {
      method: 'PUT',
      path: '/api/ingredients/:id',
      pathParams: id,
      body: ingredientInput,
      responses: { 200: ingredientSchema, ...commonErrors },
      metadata: admin,
    },
  },
  { strictStatusCodes: true },
);
