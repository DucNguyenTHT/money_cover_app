import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { CHANNELS } from '../domain/enums';
import { commonErrors, decimalString, type RouteMeta } from './common';

const c = initContract();
const admin = { roles: ['ADMIN'] } satisfies RouteMeta;

const channelCost = z.object({
  channel: z.enum(CHANNELS),
  price: decimalString.nullable(),
  ingredientCost: decimalString,
  packagingCost: decimalString,
  directCost: decimalString,
  commission: decimalString,
  overhead: decimalString,
  totalCost: decimalString,
  profit: decimalString.nullable(),
  profitPct: decimalString.nullable(),
  foodCostPct: decimalString.nullable(),
});
export type ChannelCostDto = z.infer<typeof channelCost>;

export const pricingRow = z.object({
  dishId: z.number(),
  code: z.string(),
  name: z.string(),
  categoryName: z.string(),
  targetPct: decimalString,
  hasRecipe: z.boolean(),
  /** Ingredients in the recipe never purchased yet (cost is understated). */
  missingPrices: z.array(z.string()),
  /** APP = the app picked in the context. */
  channels: z.object({ DINE_IN: channelCost, TAKEAWAY: channelCost, APP: channelCost }),
  suggestedStorePrice: decimalString.nullable(),
  /** For the app picked in the context. */
  suggestedAppPrice: decimalString.nullable(),
  /** Every active app: its price (own or general), profit after its commission and its own suggested price. */
  apps: z.array(
    z.object({
      deliveryAppId: z.number(),
      name: z.string(),
      commissionPct: decimalString,
      price: decimalString.nullable(),
      /** true = the app has its own price; false = it uses the general app price. */
      ownPrice: z.boolean(),
      directCost: decimalString,
      profit: decimalString.nullable(),
      profitPct: decimalString.nullable(),
      suggestedPrice: decimalString.nullable(),
      loss: z.boolean(),
    }),
  ),
  alert: z.enum(['LOSS', 'OVER_TARGET']).nullable(),
});
export type PricingRow = z.infer<typeof pricingRow>;

export const pricingDetail = pricingRow.extend({
  lines: z.array(
    z.object({
      ingredientId: z.number(),
      name: z.string(),
      kind: z.string(),
      scope: z.string(),
      qtyRecipe: decimalString,
      recipeUnit: z.string(),
      unitPriceRecipe: decimalString.nullable(),
      cost: decimalString,
    }),
  ),
});
export type PricingDetail = z.infer<typeof pricingDetail>;

const context = z.object({
  overheadPct: decimalString,
  /** Where the rate used comes from (MANUAL also when AUTO had to fall back, see overheadNote). */
  overheadMode: z.enum(['AUTO', 'MANUAL']),
  overheadNote: z.string().nullable(),
  /** Rate above 100 % of sales: prices built on it are not reliable. */
  overheadWarn: z.boolean(),
  app: z.object({ id: z.number(), name: z.string(), commissionPct: decimalString }).nullable(),
});
export type PricingContext = z.infer<typeof context>;

export const pricingContract = c.router(
  {
    list: {
      method: 'GET',
      path: '/api/pricing/dishes',
      query: z.object({ appId: z.coerce.number().int().optional() }),
      responses: { 200: z.object({ context, rows: z.array(pricingRow) }), ...commonErrors },
      metadata: admin,
    },
    detail: {
      method: 'GET',
      path: '/api/pricing/dishes/:id',
      pathParams: z.object({ id: z.coerce.number().int() }),
      query: z.object({ appId: z.coerce.number().int().optional() }),
      responses: { 200: z.object({ context, row: pricingDetail }), ...commonErrors },
      metadata: admin,
    },
    overhead: {
      method: 'GET',
      path: '/api/pricing/overhead',
      responses: {
        200: z.object({
          pct: decimalString,
          source: z.enum(['AUTO', 'MANUAL']),
          months: z.array(z.string()),
          note: z.string().nullable(),
          warn: z.boolean(),
        }),
        ...commonErrors,
      },
      metadata: admin,
      summary: 'Tỷ lệ chi phí chung đang dùng để tính giá và lý do',
    },
    alerts: {
      method: 'GET',
      path: '/api/pricing/alerts',
      responses: { 200: z.array(pricingRow), ...commonErrors },
      metadata: admin,
      summary: 'Món đang lỗ hoặc vượt % nguyên liệu mục tiêu theo giá nhập gần nhất',
    },
  },
  { strictStatusCodes: true },
);
