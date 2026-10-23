// The domain enums (used by the web app) must match the Prisma enums (used by the database).
import { describe, expect, it } from 'vitest';
import * as Prisma from '@prisma/client';
import * as D from '../src/domain/enums';

const pairs: [string, readonly string[], Record<string, string>][] = [
  ['Role', D.ROLES, Prisma.Role],
  ['Station', D.STATIONS, Prisma.Station],
  ['IngredientKind', D.INGREDIENT_KINDS, Prisma.IngredientKind],
  ['PriceType', D.PRICE_TYPES, Prisma.PriceType],
  ['RecipeScope', D.RECIPE_SCOPES, Prisma.RecipeScope],
  ['PrinterRole', D.PRINTER_ROLES, Prisma.PrinterRole],
  ['Channel', D.CHANNELS, Prisma.Channel],
  ['OrderStatus', D.ORDER_STATUSES, Prisma.OrderStatus],
  ['CancelKind', D.CANCEL_KINDS, Prisma.CancelKind],
  ['DiscountType', D.DISCOUNT_TYPES, Prisma.DiscountType],
  ['VatMode', D.VAT_MODES, Prisma.VatMode],
  ['KitchenStatus', D.KITCHEN_STATUSES, Prisma.KitchenStatus],
  ['ItemStatus', D.ITEM_STATUSES, Prisma.ItemStatus],
  ['PaymentMethod', D.PAYMENT_METHODS, Prisma.PaymentMethod],
  ['ReceiptKind', D.RECEIPT_KINDS, Prisma.ReceiptKind],
  ['IssueReason', D.ISSUE_REASONS, Prisma.IssueReason],
  ['StocktakeStatus', D.STOCKTAKE_STATUSES, Prisma.StocktakeStatus],
  ['DocumentKind', D.DOCUMENT_KINDS, Prisma.DocumentKind],
  ['TaxGroup', D.TAX_GROUPS, Prisma.TaxGroup],
  ['CashDirection', D.CASH_DIRECTIONS, Prisma.CashDirection],
  ['PayType', D.PAY_TYPES, Prisma.PayType],
  ['PayrollStatus', D.PAYROLL_STATUSES, Prisma.PayrollStatus],
];

describe('enum sync', () => {
  it.each(pairs)('%s matches the Prisma schema', (_name, domain, prisma) => {
    expect([...domain].sort()).toEqual(Object.values(prisma).sort());
  });
});
