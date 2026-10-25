import { describe, expect, it } from 'vitest';
import { orderTotals } from '../orders/totals';
import { cleanBuyer, invoiceDocument, paymentCode, type InvoiceOrder } from './document';

const retail = { name: null, taxCode: null, address: null, email: null };

/** An order as the app stores it, computed with the real totals function. */
function order(opts: {
  vatPct?: number;
  vatMode?: 'EXCLUSIVE' | 'INCLUSIVE';
  service?: number;
  discountPct?: number;
}) {
  const lines = [
    { name: 'Phở bò (Lớn)', qty: 2, unitPrice: 65000 },
    { name: 'Trà đá', qty: 3, unitPrice: 5000, discountAmount: 5000 },
  ];
  const t = orderTotals({
    lines,
    orderDiscount: opts.discountPct ? { type: 'PERCENT', value: opts.discountPct } : null,
    serviceChargePct: opts.service ?? 0,
    vatPct: opts.vatPct ?? 0,
    vatMode: opts.vatMode ?? 'EXCLUSIVE',
  });
  const o: InvoiceOrder = {
    code: '261023-015',
    businessDate: '2026-10-23',
    netRevenue: t.netRevenue,
    vatPct: opts.vatPct ?? 0,
    vatMode: opts.vatMode ?? 'EXCLUSIVE',
    vatAmount: t.vatAmount,
    total: t.total,
    items: lines.map((l, i) => ({ ...l, amount: t.lines[i]!.amount, netAmount: t.lines[i]!.netAmount })),
    payments: [{ method: 'CASH', amount: t.total }],
  };
  return { o, t };
}

describe('invoiceDocument', () => {
  it('household business: sales invoice, no VAT, discounts on the lines', () => {
    const { o, t } = order({ discountPct: 10 });
    const d = invoiceDocument(o, 'HOUSEHOLD', retail);
    expect(d.kind).toBe('SALES');
    expect(
      d.lines.map((l) => [
        l.name,
        l.qty,
        l.unitPrice.toString(),
        l.discount.toString(),
        l.net.toString(),
        l.taxRate,
      ]),
    ).toEqual([
      ['Phở bò (Lớn)', 2, '65000', '13000', '117000', null],
      ['Trà đá', 3, '5000', '6000', '9000', null],
    ]);
    expect(d.totalBeforeTax.toString()).toBe(t.netRevenue.toString());
    expect(d.taxTotal.toString()).toBe('0');
    expect(d.total.toString()).toBe(t.total.toString());
    expect(d.paymentMethod).toBe('TM');
  });

  it('company, VAT added on top, with a service charge line: adds up to the bill', () => {
    const { o, t } = order({ vatPct: 8, service: 5 });
    const d = invoiceDocument(o, 'DEDUCTION', {
      name: 'Công ty ABC',
      taxCode: '0101234567',
      address: 'Hà Nội',
      email: null,
    });
    expect(d.kind).toBe('VAT');
    expect(d.lines.at(-1)).toMatchObject({ name: 'Phụ thu / phí phục vụ', qty: 1 });
    expect(d.lines.every((l) => l.taxRate?.toString() === '8')).toBe(true);
    expect(d.totalBeforeTax.toString()).toBe(t.netRevenue.toString());
    expect(d.taxTotal.toString()).toBe(t.vatAmount.toString());
    expect(d.total.toString()).toBe(t.total.toString());
    expect(d.lines.reduce((s, l) => s + Number(l.tax), 0)).toBe(Number(t.vatAmount));
  });

  it('company, prices including VAT: pre-tax lines, still exact', () => {
    const { o, t } = order({ vatPct: 8, vatMode: 'INCLUSIVE', service: 5, discountPct: 10 });
    const d = invoiceDocument(o, 'DEDUCTION', retail);
    expect(d.totalBeforeTax.toString()).toBe(t.netRevenue.toString());
    expect(d.taxTotal.toString()).toBe(t.vatAmount.toString());
    expect(d.total.toString()).toBe(t.total.toString());
    for (const l of d.lines) expect(l.discount.gte(0)).toBe(true);
  });
});

describe('paymentCode / cleanBuyer', () => {
  it('maps the till payments to the invoice payment method', () => {
    expect(paymentCode([{ method: 'CASH', amount: 1 }])).toBe('TM');
    expect(paymentCode([{ method: 'TRANSFER', amount: 1 }])).toBe('CK');
    expect(
      paymentCode([
        { method: 'CASH', amount: 1 },
        { method: 'TRANSFER', amount: 1 },
      ]),
    ).toBe('TM/CK');
    expect(paymentCode([{ method: 'CARD', amount: 1 }])).toBe('KHAC');
  });

  it('checks the buyer typed at the till', () => {
    expect(cleanBuyer({ name: ' Công ty ABC ', taxCode: '0101234567' })).toEqual({
      name: 'Công ty ABC',
      taxCode: '0101234567',
      address: null,
      email: null,
    });
    expect(cleanBuyer({ taxCode: '0101234567-001', name: 'Chi nhánh' })).toMatchObject({
      taxCode: '0101234567-001',
    });
    expect(cleanBuyer({ taxCode: '123' })).toEqual({ error: expect.stringContaining('Mã số thuế') });
    expect(cleanBuyer({ taxCode: '0101234567' })).toEqual({ error: 'Nhập tên đơn vị / người mua' });
    expect(cleanBuyer(null)).toEqual(retail);
  });
});
