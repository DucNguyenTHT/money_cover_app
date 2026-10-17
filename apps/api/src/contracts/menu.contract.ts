import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { CHANNELS, PRICE_TYPES, RECIPE_SCOPES, STATIONS, TAX_GROUPS } from '../domain/enums';
import { commonErrors, decimalString, isoDate, reason, type RouteMeta } from './common';

const c = initContract();
const admin = { roles: ['ADMIN'] } satisfies RouteMeta;
const id = z.object({ id: z.coerce.number().int() });
const money = decimalString.refine((v) => Number(v) >= 0, 'Không được âm');

export const categoryInput = z.object({
  name: z.string().trim().min(1, 'Nhập tên nhóm').max(60),
  foodCostTarget: decimalString.nullable(),
  station: z.enum(STATIONS),
  /** Ngành thuế (hộ kinh doanh) của doanh thu nhóm này; ăn uống = PRODUCTION. */
  taxGroup: z.enum(TAX_GROUPS).default('PRODUCTION'),
  sort: z.number().int(),
});
export const categorySchema = categoryInput.extend({
  id: z.number(),
  dishCount: z.number(),
  taxGroup: z.enum(TAX_GROUPS),
});
export type CategoryDto = z.infer<typeof categorySchema>;

export const dishInput = z.object({
  code: z.string().trim().min(1, 'Nhập mã món').max(30),
  name: z.string().trim().min(1, 'Nhập tên món').max(120),
  categoryId: z.number().int(),
  active: z.boolean(),
  sort: z.number().int(),
});

/** Menu row as shown on POS (no cost fields). */
export const dishSchema = dishInput.extend({
  id: z.number(),
  categoryName: z.string(),
  station: z.enum(STATIONS),
  storePrice: decimalString.nullable(),
  appPrice: decimalString.nullable(),
  soldOut: z.boolean(),
  hasRecipe: z.boolean(),
});
export type DishDto = z.infer<typeof dishSchema>;

export const recipeItemInput = z.object({
  ingredientId: z.number().int(),
  /** Quantity per portion in the ingredient's RECIPE unit (g, ml…). */
  qty: decimalString.refine((v) => Number(v) > 0, 'Định mức phải lớn hơn 0'),
  scope: z.enum(RECIPE_SCOPES),
});
export const recipeInput = z.object({
  effectiveFrom: isoDate,
  note: z.string().trim().max(200).nullable(),
  items: z.array(recipeItemInput).min(1, 'Định mức phải có ít nhất 1 nguyên liệu'),
});

export const recipeSchema = z.object({
  id: z.number(),
  effectiveFrom: isoDate,
  note: z.string().nullable(),
  used: z.boolean(),
  items: z.array(
    recipeItemInput.extend({
      ingredientName: z.string(),
      recipeUnit: z.string(),
      kind: z.string(),
    }),
  ),
});
export type RecipeDto = z.infer<typeof recipeSchema>;

export const priceSchema = z.object({
  id: z.number(),
  priceType: z.enum(PRICE_TYPES),
  price: decimalString,
  effectiveFrom: isoDate,
});

export const dishDetail = dishSchema.extend({
  prices: z.array(priceSchema),
  recipes: z.array(recipeSchema),
});
export type DishDetail = z.infer<typeof dishDetail>;

export const menuContract = c.router(
  {
    listCategories: {
      method: 'GET',
      path: '/api/dish-categories',
      responses: { 200: z.array(categorySchema), ...commonErrors },
    },
    createCategory: {
      method: 'POST',
      path: '/api/dish-categories',
      body: categoryInput,
      responses: { 201: categorySchema, ...commonErrors },
      metadata: admin,
    },
    updateCategory: {
      method: 'PUT',
      path: '/api/dish-categories/:id',
      pathParams: id,
      body: categoryInput,
      responses: { 200: categorySchema, ...commonErrors },
      metadata: admin,
    },

    listDishes: {
      method: 'GET',
      path: '/api/dishes',
      query: z.object({ channel: z.enum(CHANNELS).optional(), date: isoDate.optional() }),
      responses: { 200: z.array(dishSchema), ...commonErrors },
      summary: 'Thực đơn với giá hiện hành theo ngày',
    },
    getDish: {
      method: 'GET',
      path: '/api/dishes/:id',
      pathParams: id,
      responses: { 200: dishDetail, ...commonErrors },
      metadata: admin,
    },
    createDish: {
      method: 'POST',
      path: '/api/dishes',
      body: dishInput.extend({ storePrice: money.nullable(), appPrice: money.nullable() }),
      responses: { 201: dishDetail, ...commonErrors },
      metadata: admin,
    },
    updateDish: {
      method: 'PUT',
      path: '/api/dishes/:id',
      pathParams: id,
      body: dishInput,
      responses: { 200: dishDetail, ...commonErrors },
      metadata: admin,
    },
    setPrice: {
      method: 'POST',
      path: '/api/dishes/:id/prices',
      pathParams: id,
      body: z.object({ priceType: z.enum(PRICE_TYPES), price: money, effectiveFrom: isoDate }),
      responses: { 200: dishDetail, ...commonErrors },
      metadata: admin,
      summary: 'Áp dụng giá bán mới từ một ngày',
    },
    saveRecipe: {
      method: 'POST',
      path: '/api/dishes/:id/recipes',
      pathParams: id,
      body: recipeInput,
      responses: { 200: dishDetail, ...commonErrors },
      metadata: admin,
      summary: 'Tạo phiên bản định mức (hoặc sửa phiên bản cùng ngày nếu chưa có đơn dùng)',
    },
    deleteRecipe: {
      method: 'DELETE',
      path: '/api/dishes/:id/recipes/:recipeId',
      pathParams: z.object({ id: z.coerce.number().int(), recipeId: z.coerce.number().int() }),
      body: z.object({ reason }),
      responses: { 200: dishDetail, ...commonErrors },
      metadata: admin,
    },
    setAvailability: {
      method: 'PATCH',
      path: '/api/dishes/:id/availability',
      pathParams: id,
      body: z.object({ soldOut: z.boolean() }),
      responses: { 200: dishSchema, ...commonErrors },
      summary: 'Đánh dấu hết món / còn món (tự mở lại khi sang ngày kinh doanh mới)',
    },
  },
  { strictStatusCodes: true },
);
