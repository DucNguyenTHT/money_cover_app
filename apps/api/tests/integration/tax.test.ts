import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/core/db';
import { makeUser, resetDb, startServer, stopServer } from '../helpers/harness';
import { branchId } from '../helpers/factories';

beforeAll(startServer);
afterAll(stopServer);
beforeEach(resetDb);

let seq = 0;
/** A PAID order with only money totals (no items: the whole amount counts as food revenue). */
async function paidOrder(userId: number, date: string, netRevenue: number) {
  seq++;
  await prisma.order.create({
    data: {
      branchId: await branchId(),
      code: `T${seq}`,
      businessDate: new Date(`${date}T00:00:00Z`),
      channel: 'TAKEAWAY',
      status: 'PAID',
      subtotal: netRevenue,
      netRevenue,
      total: netRevenue,
      openedById: userId,
      paidById: userId,
      paidAt: new Date(`${date}T05:00:00Z`),
    },
  });
}

const closeDay = async (userId: number, date: string) =>
  prisma.dayClosing.create({
    data: {
      branchId: await branchId(),
      businessDate: new Date(`${date}T00:00:00Z`),
      expectedCash: 0,
      countedCash: 0,
      diff: 0,
      expectedByMethod: {},
      closedById: userId,
    },
  });

describe('household tax (hộ kinh doanh)', () => {
  it('never puts VAT on the bill, whatever the VAT % setting says', async () => {
    const { client } = await makeUser({ username: 'chu', role: 'ADMIN' });
    await client.settings.update({ body: { settings: { vat_pct: 8 } } });
    const cat = await prisma.dishCategory.create({ data: { name: 'Món' } });
    const dish = await prisma.dish.create({ data: { code: 'M1', name: 'Phở', categoryId: cat.id } });
    await prisma.dishPrice.create({
      data: { dishId: dish.id, priceType: 'STORE', price: 50000, effectiveFrom: new Date('2020-01-01') },
    });
    const res = await client.orders.open({
      body: {
        channel: 'TAKEAWAY',
        tableId: null,
        deliveryAppId: null,
        appOrderCode: null,
        guestCount: 1,
        note: null,
        items: [{ dishId: dish.id, qty: 2 }],
      },
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ vatPct: '0', vatAmount: '0', total: '100000' });
  });

  it('tax report: nothing under 1 tỷ, then VAT on the whole year and PIT on profit once crossed', async () => {
    const { client, user } = await makeUser({ username: 'chu', role: 'ADMIN' });
    await paidOrder(user.id, '2026-01-15', 600_000_000);
    await paidOrder(user.id, '2026-02-15', 600_000_000);

    const res = await client.reports.tax({ query: { year: 2026 } });
    expect(res.status).toBe(200);
    const r = res.body as {
      crossedMonth: string;
      months: { month: string; vat: string; pit: string; revenueYtd: string }[];
      total: { revenue: string; vat: string; pit: string };
      pitIncomeRate: number;
    };
    expect(r.crossedMonth).toBe('2026-02');
    expect(r.months[0]).toMatchObject({ month: '2026-01', vat: '0', pit: '0' });
    // 1,2 tỷ × 2,4% = 28,8 tr (catch-up in February); PIT theo lãi: 1,2 tỷ profit (no costs) × 15%.
    expect(r.months[1]).toMatchObject({ month: '2026-02', vat: '28800000', pit: '180000000' });
    expect(r.total).toMatchObject({ revenue: '1200000000', vat: '28800000', pit: '180000000' });
    expect(r.pitIncomeRate).toBe(15);

    // Both PIT methods side by side: (1,2 − 1) tỷ × 1,5% = 3 tr vs 1,2 tỷ profit × 15% = 180 tr.
    const cmp = (res.body as { comparison: { actual: unknown; projected: unknown } }).comparison;
    expect(cmp.actual).toMatchObject({
      cheaper: 'REVENUE',
      methods: [
        { method: 'REVENUE', pit: '3000000', total: '31800000' },
        { method: 'INCOME', pit: '180000000', total: '208800000' },
      ],
    });
    // Projected year: 2 months at 600 tr average → 7,2 tỷ, above 3 tỷ so only "theo lãi" is allowed.
    expect(cmp.projected).toMatchObject({
      basisMonths: 2,
      revenue: '7200000000',
      revenueMethodAllowed: false,
      cheaper: 'INCOME',
    });

    // The P&L shows the same tax and the profit after it.
    const pnl = await client.reports.pnlMonth({ params: { month: '2026-02' } });
    const lines = (pnl.body as { lines: { key: string; amount: string; label: string }[] }).lines;
    const line = (k: string) => lines.find((l) => l.key === k);
    expect(line('netProfit')).toMatchObject({ label: 'Lợi nhuận trước thuế', amount: '600000000' });
    expect(line('taxVat')?.amount).toBe('28800000');
    expect(line('taxPit')?.amount).toBe('180000000');
    expect(line('profitAfterTax')?.amount).toBe('391200000');

    // Quarter / year chart and the period list use the same after-tax figure.
    const range = await client.reports.pnlRange({ query: { from: '2026-01', to: '2026-02' } });
    expect((range.body as { profitAfterTax: string[] }).profitAfterTax).toEqual(['600000000', '391200000']);
    const periods = await client.reports.periods({ query: { year: 2026 } });
    const feb = (periods.body as { month: string; profitAfterTax: string | null }[]).find(
      (p) => p.month === '2026-02',
    );
    expect(feb?.profitAfterTax).toBe('391200000');
  });

  it('a closed month keeps the tax it was closed with', async () => {
    const { client, user } = await makeUser({ username: 'chu', role: 'ADMIN' });
    await paidOrder(user.id, '2026-01-15', 1_200_000_000);
    await closeDay(user.id, '2026-01-15');
    expect((await client.reports.lock({ params: { month: '2026-01' }, body: {} })).status).toBe(200);

    // Switching the PIT method later does not rewrite January.
    await client.settings.update({ body: { settings: { household_pit_method: 'REVENUE' } } });
    const pnl = await client.reports.pnlMonth({ params: { month: '2026-01' } });
    const lines = (pnl.body as { lines: { key: string; amount: string }[] }).lines;
    expect(lines.find((l) => l.key === 'taxPit')?.amount).toBe('180000000');
  });

  it('a company (khấu trừ) has no tax lines in the P&L; the report shows output VAT', async () => {
    const { client, user } = await makeUser({ username: 'chu', role: 'ADMIN' });
    await client.settings.update({ body: { settings: { tax_regime: 'DEDUCTION' } } });
    await paidOrder(user.id, '2026-03-10', 1_500_000_000);
    const pnl = await client.reports.pnlMonth({ params: { month: '2026-03' } });
    const keys = (pnl.body as { lines: { key: string }[] }).lines.map((l) => l.key);
    expect(keys).not.toContain('taxVat');
    expect(keys.at(-1)).toBe('netProfit');
    const tax = await client.reports.tax({ query: { year: 2026 } });
    expect(tax.body).toMatchObject({ regime: 'DEDUCTION', total: { pit: '0' } });
  });

  it('dashboard watches the 1 tỷ threshold', async () => {
    const { client, user } = await makeUser({ username: 'chu', role: 'ADMIN' });
    const today = new Date(Date.now() + 7 * 3600_000 - 4 * 3600_000).toISOString().slice(0, 10);
    await paidOrder(user.id, today, 900_000_000);
    const d = await client.reports.dashboard();
    expect(d.body).toMatchObject({
      tax: { revenueYtd: '900000000', threshold: '1000000000', einvoiceRegistered: false },
    });
  });

  it('dish categories carry a tax group (default: food)', async () => {
    const { client } = await makeUser({ username: 'chu', role: 'ADMIN' });
    const food = await client.menu.createCategory({
      body: { name: 'Món ăn', foodCostTarget: null, station: 'KITCHEN', sort: 1 },
    });
    expect(food.body).toMatchObject({ taxGroup: 'PRODUCTION' });
    const goods = await client.menu.createCategory({
      body: {
        name: 'Bia lon bán mang về',
        foodCostTarget: null,
        station: 'BAR',
        sort: 2,
        taxGroup: 'DISTRIBUTION',
      },
    });
    expect(goods.body).toMatchObject({ taxGroup: 'DISTRIBUTION' });
  });
});
