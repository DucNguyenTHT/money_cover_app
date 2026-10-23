import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { commonErrors, decimalString, isoDate, reason, type RouteMeta } from './common';

const c = initContract();
const admin = { roles: ['ADMIN'] } satisfies RouteMeta;
const money = decimalString;
const monthStr = z.string().regex(/^\d{4}-\d{2}$/, 'Tháng phải có dạng YYYY-MM');
const range = z.object({ from: isoDate, to: isoDate });

export const MONTH_STATUSES = [
  'CLOSED',
  'PROVISIONAL',
  'NO_STOCKTAKE',
  'MISSING_OVERHEAD',
  'PENDING_STOCK',
] as const;
const statuses = z.array(z.enum(MONTH_STATUSES));

const lineBase = z.object({
  key: z.string(),
  no: z.string(),
  label: z.string(),
  deduct: z.boolean(),
  total: z.boolean(),
  child: z.boolean(),
});

export const monthPnlSchema = z.object({
  month: monthStr,
  statuses,
  locked: z.boolean(),
  lines: z.array(
    lineBase.extend({
      amount: money,
      /** % of net revenue (null without revenue). */
      pct: z.string().nullable(),
      previous: money,
      diff: money,
      ytd: money,
    }),
  ),
  kpis: z.object({
    orders: z.number(),
    guests: z.number(),
    avgPerOrder: money,
    foodCostPct: z.string().nullable(),
    vatCollected: money,
    netByChannel: z.record(money),
    byMethod: z.record(money),
    cashDiff: money,
    purchases: money,
    supplierReturns: money,
    stockStart: money,
    stockEnd: money,
    /** Stock start + purchases + surpluses − issues − shortages − end (≈ 0 except rounding). */
    stockBalanceGap: money,
  }),
  flags: z.object({
    pendingLines: z.number(),
    openOrders: z.number(),
    unclosedDays: z.number(),
    hasStocktake: z.boolean(),
    hasOverhead: z.boolean(),
  }),
});
export type MonthPnl = z.infer<typeof monthPnlSchema>;

export const rangePnlSchema = z.object({
  months: z.array(z.object({ month: monthStr, statuses })),
  rows: z.array(lineBase.extend({ amounts: z.array(money), total: z.boolean(), sum: money })),
  netRevenue: z.array(money),
  netProfit: z.array(money),
  /** Household: profit after the estimated tax, per month (null for a company). */
  profitAfterTax: z.array(money).nullable(),
});
export type RangePnl = z.infer<typeof rangePnlSchema>;

export const dailyRowSchema = z.object({
  day: isoDate,
  orders: z.number(),
  guests: z.number(),
  netRevenue: money,
  cost: money,
  grossProfit: money,
  discounts: money,
  vat: money,
  appCommission: money,
  cancelled: z.number(),
  belowCost: z.number(),
  cashDiff: money.nullable(),
  closed: z.boolean(),
});
export type DailyRow = z.infer<typeof dailyRowSchema>;

const amountRow = z.object({ key: z.string(), label: z.string(), orders: z.number(), netRevenue: money });

export const salesSchema = z.object({
  byHour: z.array(z.object({ hour: z.number(), orders: z.number(), netRevenue: money })),
  byChannel: z.array(amountRow),
  byMethod: z.array(z.object({ key: z.string(), label: z.string(), payments: z.number(), amount: money })),
  byTable: z.array(amountRow),
  byStaff: z.array(amountRow.extend({ discounts: money })),
  topDishes: z.array(z.object({ dishId: z.number(), name: z.string(), qty: z.number(), netRevenue: money })),
  /** Options sold (size, toppings, requests): portions and their added price (before discounts). */
  topOptions: z.array(z.object({ groupName: z.string(), name: z.string(), qty: z.number(), amount: money })),
});
export type SalesReport = z.infer<typeof salesSchema>;

export const dishProfitSchema = z.object({
  overheadRate: z.string().nullable(),
  stocktakeIncluded: z.boolean(),
  rows: z.array(
    z.object({
      dishId: z.number(),
      name: z.string(),
      category: z.string(),
      qty: z.number(),
      netRevenue: money,
      cost: money,
      grossProfit: money,
      foodCostPct: z.string().nullable(),
      stocktake: money,
      afterStocktake: money,
      appCommission: money,
      overhead: money,
      netProfit: money,
      perPortion: money,
    }),
  ),
  /** Σ dishes after stocktake + service charge − general loss − disposal − app − internal − overhead ≈ net profit. */
  reconciliation: z
    .object({
      dishesAfterStocktake: money,
      serviceCharge: money,
      generalLoss: money,
      disposal: money,
      appCommission: money,
      internalUse: money,
      overhead: money,
      result: money,
      pnlNetProfit: money,
    })
    .nullable(),
});
export type DishProfitReport = z.infer<typeof dishProfitSchema>;

export const cancellationsSchema = z.object({
  orders: z.array(
    z.object({
      id: z.number(),
      code: z.string(),
      day: isoDate,
      channel: z.string(),
      total: money,
      reason: z.string().nullable(),
      cancelledAt: z.string().nullable(),
      wasPaid: z.boolean(),
      cancelledBy: z.string().nullable(),
      approvedBy: z.string().nullable(),
    }),
  ),
  items: z.array(
    z.object({
      id: z.number(),
      code: z.string(),
      day: isoDate,
      dish: z.string(),
      qty: z.number(),
      amount: money,
      reason: z.string().nullable(),
      wasted: z.boolean(),
      cancelledAt: z.string().nullable(),
      cancelledBy: z.string().nullable(),
    }),
  ),
  discounts: z.array(
    z.object({
      id: z.number(),
      code: z.string(),
      day: isoDate,
      subtotal: money,
      discount: money,
      reason: z.string().nullable(),
      netRevenue: money,
      cost: money,
      profit: money,
      paidBy: z.string().nullable(),
      approvedBy: z.string().nullable(),
    }),
  ),
});
export type CancellationsReport = z.infer<typeof cancellationsSchema>;

const mv = z.object({ qty: decimalString, value: money });
export const stockMovementSchema = z.object({
  rows: z.array(
    z.object({
      ingredientId: z.number(),
      code: z.string(),
      name: z.string(),
      unit: z.string(),
      opening: mv,
      purchased: mv,
      surplus: mv,
      sold: mv,
      disposed: mv,
      returned: mv,
      internal: mv,
      shortage: mv,
      closing: mv,
    }),
  ),
});
export type StockMovementReport = z.infer<typeof stockMovementSchema>;

export const varianceSchema = z.array(
  z.object({
    stocktakeId: z.number(),
    day: isoDate,
    code: z.string(),
    name: z.string(),
    unit: z.string(),
    bookQty: decimalString,
    actualQty: decimalString,
    diffQty: decimalString,
    lossValue: money,
  }),
);

export const dashboardSchema = z.object({
  today: isoDate,
  todayOrders: z.number(),
  todayGuests: z.number(),
  todayNetRevenue: money,
  todayGrossProfit: money,
  yesterdayNetRevenue: money,
  openOrders: z.number(),
  tablesInUse: z.number(),
  tablesTotal: z.number(),
  month: monthStr,
  monthStatuses: statuses,
  monthNetRevenue: money,
  monthGrossProfit: money,
  monthNetProfit: money,
  /** Household: month profit after the estimated tax (null for a company). */
  monthProfitAfterTax: money.nullable(),
  last30: z.array(z.object({ day: isoDate, netRevenue: money, grossProfit: money })),
  byHourToday: z.array(z.object({ hour: z.number(), netRevenue: money })),
  topDishes: z.array(z.object({ name: z.string(), qty: z.number(), netRevenue: money })),
  /** First-run checklist: what a new shop still has to set up. */
  setup: z.object({
    shopNamed: z.boolean(),
    staffAccounts: z.boolean(),
    dishes: z.boolean(),
    recipes: z.boolean(),
    openingStock: z.boolean(),
    printers: z.boolean(),
    pinSet: z.boolean(),
  }),
  alerts: z.object({
    pendingIngredients: z.number(),
    /** Dishes losing money / over their food-cost target. */
    priceAlerts: z.number(),
    lossDishes: z.number(),
    /** Options (sizes per dish, add-ons once) losing money / over target. */
    optionAlerts: z.number(),
    cancelledToday: z.number(),
    belowCostToday: z.number(),
    unclosedDays: z.number(),
    /** Orders still open from an earlier business day (that day cannot be closed). */
    staleOpenOrders: z.number(),
    /** Ingredients out of stock or running low (Cần nhập hàng). */
    lowStock: z.number(),
    /** Database backup needs attention (see backups.contract). */
    backup: z.enum(['NEVER', 'FAILED', 'STALE', 'DRIVE_FAILED', 'TELEGRAM_FAILED']).nullable(),
    lockedPins: z.number(),
  }),
  /** Household tax threshold watch (null for a company). */
  tax: z
    .object({
      revenueYtd: money,
      threshold: money,
      einvoiceRegistered: z.boolean(),
    })
    .nullable(),
});
export type Dashboard = z.infer<typeof dashboardSchema>;

export const TAX_REGIME_VALUES = ['HOUSEHOLD', 'DEDUCTION'] as const;

const pitMethod = z.enum(['INCOME', 'REVENUE']);
const methodComparison = z.object({
  revenue: money,
  profit: money,
  methods: z.array(z.object({ method: pitMethod, vat: money, pit: money, total: money })),
  revenueMethodAllowed: z.boolean(),
  /** Profit at which both PIT methods cost the same. */
  breakEvenProfit: money.nullable(),
  cheaper: pitMethod.nullable(),
});
export type MethodComparisonDto = z.infer<typeof methodComparison>;

export const taxReportSchema = z.object({
  year: z.number(),
  regime: z.enum(TAX_REGIME_VALUES),
  pitMethod: z.enum(['INCOME', 'REVENUE']),
  einvoiceRegistered: z.boolean(),
  threshold: money,
  /** First month whose year-to-date revenue is above the threshold. */
  crossedMonth: monthStr.nullable(),
  months: z.array(
    z.object({
      month: monthStr,
      locked: z.boolean(),
      revenue: money,
      revenueYtd: money,
      /** Profit before tax. */
      profit: money,
      vat: money,
      pit: money,
    }),
  ),
  quarters: z.array(
    z.object({
      quarter: z.number(),
      revenue: money,
      vat: money,
      pit: money,
      deadline: isoDate,
    }),
  ),
  total: z.object({ revenue: money, profit: money, vat: money, pit: money }),
  /** Revenue of the year per tax group with the rates in force today. */
  groups: z.array(
    z.object({
      group: z.string(),
      label: z.string(),
      revenue: money,
      vatRate: z.string(),
      pitRate: z.string(),
    }),
  ),
  /** PIT rate on profit for the year's revenue (household, theo lãi). */
  pitIncomeRate: z.number(),
  /** Household: both PIT methods side by side — so far this year and projected to the full year. */
  comparison: z
    .object({
      actual: methodComparison,
      /** Months with data averaged over 12 months (null for a past year or without data). */
      projected: methodComparison.extend({ basisMonths: z.number() }).nullable(),
    })
    .nullable(),
});
export type TaxReport = z.infer<typeof taxReportSchema>;

export const periodSchema = z.object({
  month: monthStr,
  statuses,
  locked: z.boolean(),
  lockedAt: z.string().nullable(),
  lockedByName: z.string().nullable(),
  netRevenue: money,
  netProfit: money,
  /** Household: profit after the estimated tax (null for a company). */
  profitAfterTax: money.nullable(),
  problems: z.array(z.string()),
  hasActivity: z.boolean(),
});
export type PeriodDto = z.infer<typeof periodSchema>;

export const auditLogSchema = z.object({
  id: z.number(),
  entity: z.string(),
  entityId: z.string(),
  action: z.string(),
  reason: z.string().nullable(),
  before: z.unknown(),
  after: z.unknown(),
  userName: z.string().nullable(),
  approvedByName: z.string().nullable(),
  createdAt: z.string(),
});
export type AuditLogDto = z.infer<typeof auditLogSchema>;

export const reportsContract = c.router(
  {
    dashboard: {
      method: 'GET',
      path: '/api/reports/dashboard',
      responses: { 200: dashboardSchema, ...commonErrors },
      metadata: admin,
    },
    pnlMonth: {
      method: 'GET',
      path: '/api/reports/pnl/:month',
      pathParams: z.object({ month: monthStr }),
      responses: { 200: monthPnlSchema, ...commonErrors },
      metadata: admin,
      summary: 'Lãi lỗ một tháng: so tháng trước, luỹ kế năm (tháng đã khoá đọc số đã chốt)',
    },
    pnlRange: {
      method: 'GET',
      path: '/api/reports/pnl',
      query: z.object({ from: monthStr, to: monthStr }),
      responses: { 200: rangePnlSchema, ...commonErrors },
      metadata: admin,
      summary: 'Lãi lỗ nhiều tháng (quý / năm): mỗi tháng 1 cột + tổng',
    },
    tax: {
      method: 'GET',
      path: '/api/reports/tax',
      query: z.object({ year: z.coerce.number().int().min(2000).max(2100) }),
      responses: { 200: taxReportSchema, ...commonErrors },
      metadata: admin,
      summary: 'Thuế phải nộp theo tháng / quý / năm (hộ kinh doanh: GTGT + TNCN tạm tính)',
    },
    daily: {
      method: 'GET',
      path: '/api/reports/daily',
      query: range,
      responses: { 200: z.array(dailyRowSchema), ...commonErrors },
      metadata: admin,
    },
    sales: {
      method: 'GET',
      path: '/api/reports/sales',
      query: range,
      responses: { 200: salesSchema, ...commonErrors },
      metadata: admin,
    },
    dishProfit: {
      method: 'GET',
      path: '/api/reports/dish-profit',
      query: range.extend({ channel: z.enum(['DINE_IN', 'TAKEAWAY', 'APP']).optional() }),
      responses: { 200: dishProfitSchema, ...commonErrors },
      metadata: admin,
    },
    cancellations: {
      method: 'GET',
      path: '/api/reports/cancellations',
      query: range,
      responses: { 200: cancellationsSchema, ...commonErrors },
      metadata: admin,
    },
    stockMovement: {
      method: 'GET',
      path: '/api/reports/stock-movement',
      query: range,
      responses: { 200: stockMovementSchema, ...commonErrors },
      metadata: admin,
    },
    variance: {
      method: 'GET',
      path: '/api/reports/variance',
      query: range,
      responses: { 200: varianceSchema, ...commonErrors },
      metadata: admin,
    },

    periods: {
      method: 'GET',
      path: '/api/periods',
      query: z.object({ year: z.coerce.number().int() }),
      responses: { 200: z.array(periodSchema), ...commonErrors },
      metadata: admin,
    },
    lock: {
      method: 'POST',
      path: '/api/periods/:month/lock',
      pathParams: z.object({ month: monthStr }),
      body: z.object({}),
      responses: { 200: periodSchema, ...commonErrors },
      metadata: admin,
      summary: 'Khoá sổ tháng và chốt số liệu lãi lỗ (monthly_closings)',
    },
    unlock: {
      method: 'POST',
      path: '/api/periods/:month/unlock',
      pathParams: z.object({ month: monthStr }),
      body: z.object({ reason }),
      responses: { 200: periodSchema, ...commonErrors },
      metadata: admin,
    },

    auditLogs: {
      method: 'GET',
      path: '/api/audit-logs',
      query: z.object({
        from: isoDate,
        to: isoDate,
        entity: z.string().optional(),
        q: z.string().optional(),
        before: z.coerce.number().int().optional(),
      }),
      responses: {
        200: z.object({ rows: z.array(auditLogSchema), entities: z.array(z.string()), hasMore: z.boolean() }),
        ...commonErrors,
      },
      metadata: admin,
    },
  },
  { strictStatusCodes: true },
);
