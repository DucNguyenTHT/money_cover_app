// Pure enums shared by API and web. Values must match prisma/schema.prisma (tests/enums-sync.test.ts).

const values = <const T extends readonly string[]>(...v: T) => v;

export const ROLES = values('ADMIN', 'STAFF', 'KITCHEN');
export type Role = (typeof ROLES)[number];

export const STATIONS = values('KITCHEN', 'BAR');
export type Station = (typeof STATIONS)[number];

export const INGREDIENT_KINDS = values('INGREDIENT', 'PACKAGING');
export type IngredientKind = (typeof INGREDIENT_KINDS)[number];

export const PRICE_TYPES = values('STORE', 'APP');
export type PriceType = (typeof PRICE_TYPES)[number];

export const RECIPE_SCOPES = values('ALL', 'TAKEAWAY_APP');
export type RecipeScope = (typeof RECIPE_SCOPES)[number];

export const PRINTER_ROLES = values('BILL', 'KITCHEN', 'BAR');
export type PrinterRole = (typeof PRINTER_ROLES)[number];

export const CHANNELS = values('DINE_IN', 'TAKEAWAY', 'APP');
export type Channel = (typeof CHANNELS)[number];

export const ORDER_STATUSES = values('OPEN', 'PAID', 'CANCELLED');
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const CANCEL_KINDS = values('CANCELLED', 'MERGED');
export type CancelKind = (typeof CANCEL_KINDS)[number];

export const DISCOUNT_TYPES = values('PERCENT', 'AMOUNT');
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

export const VAT_MODES = values('EXCLUSIVE', 'INCLUSIVE');
export type VatMode = (typeof VAT_MODES)[number];

export const KITCHEN_STATUSES = values('NEW', 'SENT', 'DONE', 'SERVED');
export type KitchenStatus = (typeof KITCHEN_STATUSES)[number];

export const ITEM_STATUSES = values('ACTIVE', 'CANCELLED');
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const PAYMENT_METHODS = values('CASH', 'TRANSFER', 'CARD', 'APP');
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const RECEIPT_KINDS = values('PURCHASE', 'OPENING');
export type ReceiptKind = (typeof RECEIPT_KINDS)[number];

export const ISSUE_REASONS = values('SALE_USE', 'DISPOSAL', 'SUPPLIER_RETURN', 'INTERNAL_USE');
export type IssueReason = (typeof ISSUE_REASONS)[number];

export const STOCKTAKE_STATUSES = values('DRAFT', 'DONE', 'CANCELLED');
export type StocktakeStatus = (typeof STOCKTAKE_STATUSES)[number];

export const DOCUMENT_KINDS = values('PURCHASE', 'SALE', 'OTHER');
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const TAX_GROUPS = values('DISTRIBUTION', 'SERVICE', 'PRODUCTION', 'OTHER');
export type TaxGroup = (typeof TAX_GROUPS)[number];

export const CASH_DIRECTIONS = values('IN', 'OUT');
export type CashDirection = (typeof CASH_DIRECTIONS)[number];

export const PAY_TYPES = values('HOURLY', 'MONTHLY');
export type PayType = (typeof PAY_TYPES)[number];

export const PAYROLL_STATUSES = values('DRAFT', 'CLOSED');
export type PayrollStatus = (typeof PAYROLL_STATUSES)[number];

/** How a supplier was paid; OPENING = settled before payables were tracked. */
export const SUPPLIER_PAY_METHODS = values('CASH', 'TRANSFER', 'OPENING');
export type SupplierPayMethod = (typeof SUPPLIER_PAY_METHODS)[number];

export const TAX_REGIMES = values('HOUSEHOLD', 'DEDUCTION');
export type TaxRegime = (typeof TAX_REGIMES)[number];

/** Telegram messages to the owner: day-closing report, morning digest, instant alert. */
export const NOTIFY_KINDS = values('DAILY', 'MORNING', 'ALERT');
export type NotifyKind = (typeof NOTIFY_KINDS)[number];

/** Bank-feed services (báo biến động số dư) the shop may connect. */
export const BANK_PROVIDERS = values('SEPAY', 'CASSO');
export type BankProvider = (typeof BANK_PROVIDERS)[number];

/** How a bank transfer was tied to an order: order code in the content, the amount a till waited for, by hand. */
export const MATCH_KINDS = values('CODE', 'AMOUNT', 'MANUAL');
export type MatchKind = (typeof MATCH_KINDS)[number];

/** Price list used by each sales channel. */
export const PRICE_TYPE_BY_CHANNEL: Record<Channel, PriceType> = {
  DINE_IN: 'STORE',
  TAKEAWAY: 'STORE',
  APP: 'APP',
};
