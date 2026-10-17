import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/core/db';
import { toDbDate } from '../../src/domain/business-date';
import { shiftMonth } from '../../src/domain/period/pnl';
import { businessToday } from '../../src/modules/settings/settings.service';
import type { MonthPnl, OrderDto, PeriodDto, RangePnl, DishProfitReport } from '../../src/contracts';
import { makeUser, resetDb, startServer, stopServer } from '../helpers/harness';
import { branchId, makeIngredient } from '../helpers/factories';

beforeAll(startServer);
afterAll(stopServer);
beforeEach(resetDb);

/**
 * Previous month: 4 phở (200.000, cost 80.000), no overheads.
 * This month: 2 phở (100.000, cost 40.000), overhead 30.000.
 */
async function setup() {
  const admin = await makeUser({ username: 'quanly', role: 'ADMIN' });
  const c = admin.client;
  const cat = (
    await c.menu.createCategory({ body: { name: 'Món', foodCostTarget: null, station: 'KITCHEN', sort: 1 } })
  ).body as { id: number };
  const beef = await makeIngredient({ name: 'Thịt bò' });
  await prisma.lot.create({
    data: {
      branchId: await branchId(),
      ingredientId: beef.id,
      date: toDbDate('2025-01-01'),
      unitPrice: 100000,
      qtyIn: 10,
      qtyRemaining: 10,
    },
  });
  const dish = (
    await c.menu.createDish({
      body: {
        code: 'PHO',
        name: 'Phở',
        categoryId: cat.id,
        active: true,
        sort: 1,
        storePrice: '50000',
        appPrice: null,
      },
    })
  ).body as { id: number };
  await c.menu.saveRecipe({
    params: { id: dish.id },
    body: {
      effectiveFrom: '2025-01-01',
      note: null,
      items: [{ ingredientId: beef.id, qty: '200', scope: 'ALL' }],
    },
  });
  await prisma.dishPrice.updateMany({ data: { effectiveFrom: toDbDate('2025-01-01') } });

  const sell = async (qty: number) => {
    const o = (
      await c.orders.open({
        body: {
          channel: 'TAKEAWAY',
          tableId: null,
          deliveryAppId: null,
          appOrderCode: null,
          guestCount: 1,
          note: null,
          items: [{ dishId: dish.id, qty }],
        },
      })
    ).body as OrderDto;
    await c.orders.pay({
      params: { id: o.id },
      body: { version: o.version, print: false, payments: [{ method: 'CASH', amount: o.total }] },
    });
    return o;
  };
  const today = await businessToday();
  const month = today.slice(0, 7);
  const prev = shiftMonth(month, -1);
  const prevDay = `${prev}-15`;

  const a = await sell(4);
  await prisma.order.update({ where: { id: a.id }, data: { businessDate: toDbDate(prevDay) } });
  await prisma.issue.updateMany({ where: { orderId: a.id }, data: { date: toDbDate(prevDay) } });
  await sell(2);
  const [y, m] = month.split('-').map(Number) as [number, number];
  await c.overheads.saveMonth({
    params: { year: y, month: m },
    body: { lines: [{ category: 'Điện', amount: '30000', note: null }] },
  });
  return { c, a, today, month, prev, prevDay };
}

const line = (p: MonthPnl, key: string) => p.lines.find((l) => l.key === key)!;

describe('reports', () => {
  it('monthly P&L lines, previous month, YTD and statuses', async () => {
    const { c, month, prev } = await setup();
    const p = (await c.reports.pnlMonth({ params: { month } })).body as MonthPnl;
    expect(line(p, 'netRevenue')).toMatchObject({ amount: '100000', previous: '200000', pct: '100' });
    expect(line(p, 'cogs').amount).toBe('40000');
    expect(line(p, 'grossProfit').amount).toBe('60000');
    expect(line(p, 'overhead').amount).toBe('30000');
    expect(line(p, 'netProfit').amount).toBe('30000');
    expect(line(p, 'netRevenue').ytd).toBe(prev.slice(0, 4) === month.slice(0, 4) ? '300000' : '100000');
    expect(p.statuses).toEqual(['PROVISIONAL', 'NO_STOCKTAKE']);
    expect(p.kpis).toMatchObject({ orders: 1, foodCostPct: '40', stockBalanceGap: '0' });

    const r = (await c.reports.pnlRange({ query: { from: prev, to: month } })).body as RangePnl;
    const net = r.rows.find((x) => x.key === 'netRevenue')!;
    expect(net.amounts).toEqual(['200000', '100000']);
    expect(net.sum).toBe('300000');
    expect(r.rows.find((x) => x.key === 'netProfit')!.sum).toBe('150000');
    expect(r.months[0]!.statuses).toContain('MISSING_OVERHEAD');
  });

  it('dish profit reconciles with the P&L net profit', async () => {
    const { c, month } = await setup();
    const from = `${month}-01`;
    const d = (await c.reports.dishProfit({ query: { from, to: await businessToday() } }))
      .body as DishProfitReport;
    expect(d.rows[0]).toMatchObject({
      qty: 2,
      netRevenue: '100000',
      cost: '40000',
      overhead: '30000',
      netProfit: '30000',
      perPortion: '15000',
    });
    expect(d.reconciliation!.result).toBe(d.reconciliation!.pnlNetProfit);
  });

  it('locking needs the previous month and closed days; the closed month is frozen until unlocked', async () => {
    const { c, a, month, prev, prevDay } = await setup();
    expect((await c.reports.lock({ params: { month }, body: {} })).status).toBe(409);
    const blocked = await c.reports.lock({ params: { month: prev }, body: {} });
    expect(blocked.status).toBe(409);
    expect(JSON.stringify(blocked.body)).toContain('chưa chốt ngày');

    await c.dayClosing.close({ params: { date: prevDay }, body: { countedCash: '200000', note: null } });
    const locked = await c.reports.lock({ params: { month: prev }, body: {} });
    expect(locked.status).toBe(200);
    expect((locked.body as PeriodDto).statuses).toEqual(['CLOSED']);
    expect(await prisma.monthlyClosing.count()).toBe(1);

    // Data changed behind the app's back does not move a closed month.
    await prisma.order.update({ where: { id: a.id }, data: { netRevenue: 999 } });
    const frozen = (await c.reports.pnlMonth({ params: { month: prev } })).body as MonthPnl;
    expect(line(frozen, 'netRevenue').amount).toBe('200000');
    // Writes into a closed month are refused.
    expect(
      (
        await c.overheads.saveMonth({
          params: { year: Number(prev.slice(0, 4)), month: Number(prev.slice(5)) },
          body: { lines: [] },
        })
      ).status,
    ).toBe(409);

    const unlocked = await c.reports.unlock({
      params: { month: prev },
      body: { reason: 'Sửa số liệu tháng trước' },
    });
    expect(unlocked.status).toBe(200);
    expect(await prisma.monthlyClosing.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { entity: 'period', action: 'UNLOCK' } })).toBe(1);
    const live = (await c.reports.pnlMonth({ params: { month: prev } })).body as MonthPnl;
    expect(line(live, 'netRevenue').amount).toBe('999');
  });

  it('dashboard, daily and the other reports answer', async () => {
    const { c, today, prev } = await setup();
    const dash = await c.reports.dashboard();
    expect(dash.status).toBe(200);
    expect(dash.body).toMatchObject({ todayOrders: 1, todayNetRevenue: '100000' });
    const from = `${prev}-01`;
    for (const res of await Promise.all([
      c.reports.daily({ query: { from, to: today } }),
      c.reports.sales({ query: { from, to: today } }),
      c.reports.cancellations({ query: { from, to: today } }),
      c.reports.stockMovement({ query: { from, to: today } }),
      c.reports.variance({ query: { from, to: today } }),
      c.reports.periods({ query: { year: Number(today.slice(0, 4)) } }),
      c.reports.auditLogs({ query: { from, to: today } }),
    ])) {
      expect(res.status).toBe(200);
    }
    const mv = (await c.reports.stockMovement({ query: { from: `${today.slice(0, 7)}-01`, to: today } }))
      .body as { rows: { opening: { qty: string }; sold: { qty: string }; closing: { qty: string } }[] };
    expect(mv.rows[0]).toMatchObject({
      opening: { qty: '9.2' },
      sold: { qty: '0.4' },
      closing: { qty: '8.8' },
    });
  });
});
