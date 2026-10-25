// The e-invoice of a paid order, independent of the provider that issues it. Amounts add up exactly to the order:
// Σ pre-tax = net revenue, Σ tax = VAT of the order, pre-tax + tax = what the customer paid.
import { D, Decimal, ZERO, allocateVnd, roundVnd, sum, type Num } from '../money';
import type { PaymentMethod, TaxRegime, VatMode } from '../enums';

export interface InvoiceBuyer {
  /** Company / person name on the invoice; empty = retail customer who did not ask for one. */
  name: string | null;
  taxCode: string | null;
  address: string | null;
  email: string | null;
}

export interface InvoiceLine {
  name: string;
  unit: string;
  qty: number;
  /** Price per unit before discount and tax. */
  unitPrice: Decimal;
  /** qty × unitPrice before discount (pre-tax). */
  gross: Decimal;
  discount: Decimal;
  /** gross − discount, pre-tax. */
  net: Decimal;
  /** null for a household business (sales invoice, no VAT shown). */
  taxRate: Decimal | null;
  tax: Decimal;
}

export interface InvoiceDocument {
  orderCode: string;
  /** Business date of the sale. */
  date: string;
  buyer: InvoiceBuyer;
  lines: InvoiceLine[];
  totalBeforeTax: Decimal;
  taxTotal: Decimal;
  total: Decimal;
  /** TM cash, CK transfer, TM/CK both, KHAC card / app / anything else. */
  paymentMethod: 'TM' | 'CK' | 'TM/CK' | 'KHAC';
  /** Household business: "hoá đơn bán hàng" (no VAT); company: "hoá đơn GTGT". */
  kind: 'SALES' | 'VAT';
}

export interface InvoiceOrder {
  code: string;
  businessDate: string;
  netRevenue: Num;
  vatPct: Num;
  vatMode: VatMode;
  vatAmount: Num;
  total: Num;
  items: { name: string; qty: number; unitPrice: Num; amount: Num; netAmount: Num }[];
  payments: { method: PaymentMethod; amount: Num }[];
}

const SERVICE_NAME = 'Phụ thu / phí phục vụ';

export function paymentCode(payments: readonly { method: PaymentMethod; amount: Num }[]) {
  const used = new Set(payments.filter((p) => D(p.amount).gt(0)).map((p) => p.method));
  const cash = used.has('CASH');
  const transfer = used.has('TRANSFER');
  const other = used.has('CARD') || used.has('APP');
  if (other) return 'KHAC' as const;
  if (cash && transfer) return 'TM/CK' as const;
  return transfer ? ('CK' as const) : ('TM' as const);
}

/** VAT contained in a VAT-inclusive amount. */
const vatInside = (gross: Decimal, pct: Decimal) =>
  pct.isZero() ? ZERO : roundVnd(gross.mul(pct).div(D(100).add(pct)));

export function invoiceDocument(o: InvoiceOrder, regime: TaxRegime, buyer: InvoiceBuyer): InvoiceDocument {
  const vat = regime === 'HOUSEHOLD' ? ZERO : D(o.vatPct);
  const rate = regime === 'HOUSEHOLD' ? null : vat;
  const lines: InvoiceLine[] = o.items
    .filter((i) => i.qty > 0)
    .map((i) => {
      const net = D(i.netAmount);
      // The sold amount excludes VAT when VAT is added on top; it contains it when prices include VAT.
      const grossSold = D(i.amount);
      const gross = o.vatMode === 'INCLUSIVE' ? grossSold.sub(vatInside(grossSold, vat)) : grossSold;
      const g = Decimal.max(gross, net);
      return {
        name: i.name,
        unit: 'phần',
        qty: i.qty,
        unitPrice: g.div(i.qty).toDecimalPlaces(2),
        gross: g,
        discount: g.sub(net),
        net,
        taxRate: rate,
        tax: ZERO,
      };
    });
  const service = D(o.netRevenue).sub(sum(lines.map((l) => l.net)));
  if (service.gt(0))
    lines.push({
      name: SERVICE_NAME,
      unit: 'lần',
      qty: 1,
      unitPrice: service,
      gross: service,
      discount: ZERO,
      net: service,
      taxRate: rate,
      tax: ZERO,
    });
  const taxTotal = regime === 'HOUSEHOLD' ? ZERO : roundVnd(o.vatAmount);
  if (taxTotal.gt(0)) {
    const shares = allocateVnd(
      taxTotal,
      lines.map((l) => l.net),
    );
    lines.forEach((l, k) => (l.tax = shares[k]!));
  }
  const totalBeforeTax = sum(lines.map((l) => l.net));
  return {
    orderCode: o.code,
    date: o.businessDate,
    buyer,
    lines,
    totalBeforeTax,
    taxTotal,
    total: totalBeforeTax.add(taxTotal),
    paymentMethod: paymentCode(o.payments),
    kind: regime === 'HOUSEHOLD' ? 'SALES' : 'VAT',
  };
}

/** Buyer typed at the till: trimmed, empty fields dropped; a tax code needs a name. */
export function cleanBuyer(b: Partial<InvoiceBuyer> | null | undefined): InvoiceBuyer | { error: string } {
  const t = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);
  const out = { name: t(b?.name), taxCode: t(b?.taxCode), address: t(b?.address), email: t(b?.email) };
  if (out.taxCode && !/^\d{10}(-\d{3})?$|^\d{12}$/.test(out.taxCode))
    return { error: 'Mã số thuế gồm 10 số (chi nhánh: 10 số-3 số) hoặc 12 số' };
  if (out.taxCode && !out.name) return { error: 'Nhập tên đơn vị / người mua' };
  if (out.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(out.email)) return { error: 'Email không hợp lệ' };
  return out;
}
