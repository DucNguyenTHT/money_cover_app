import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/core/db';
import { toDbDate } from '../../src/domain/business-date';
import { businessToday } from '../../src/modules/settings/settings.service';
import type { OrderDto, StocktakeDetail } from '../../src/contracts';
import { makeUser, resetDb, startServer, stopServer } from '../helpers/harness';
import { branchId, makeIngredient } from '../helpers/factories';

beforeAll(startServer);
afterAll(stopServer);
beforeEach(resetDb);

/** Beef 10 kg at 120.000; phở and bún each use 200 g; 10 of each sold today → 4 kg used. */
async function setup() {
  const admin = await makeUser({ username: 'quanly', role: 'ADMIN' });
  const staff = await makeUser({ username: 'thungan', role: 'STAFF' });
  const c = admin.client;
  const cat = (
    await c.menu.createCategory({ body: { name: 'Món', foodCostTarget: null, station: 'KITCHEN', sort: 1 } })
  ).body as { id: number };
  const beef = await makeIngredient({ name: 'Thịt bò' });
  const onion = await makeIngredient({ name: 'Hành' });
  await prisma.lot.create({
    data: {
      branchId: await branchId(),
      ingredientId: beef.id,
      date: toDbDate('2026-01-01'),
      unitPrice: 120000,
      qtyIn: 10,
      qtyRemaining: 10,
    },
  });
  await prisma.lot.create({
    data: {
      branchId: await branchId(),
      ingredientId: onion.id,
      date: toDbDate('2026-01-01'),
      unitPrice: 20000,
      qtyIn: 5,
      qtyRemaining: 5,
    },
  });
  const dish = async (code: string, name: string) => {
    const d = (
      await c.menu.createDish({
        body: { code, name, categoryId: cat.id, active: true, sort: 1, storePrice: '50000', appPrice: null },
      })
    ).body as { id: number };
    await c.menu.saveRecipe({
      params: { id: d.id },
      body: {
        effectiveFrom: '2026-01-01',
        note: null,
        items: [{ ingredientId: beef.id, qty: '200', scope: 'ALL' }],
      },
    });
    return d.id;
  };
  const pho = await dish('PHO', 'Phở');
  const bun = await dish('BUN', 'Bún');
  const o = (
    await c.orders.open({
      body: {
        channel: 'TAKEAWAY',
        tableId: null,
        deliveryAppId: null,
        appOrderCode: null,
        guestCount: 1,
        note: null,
        items: [
          { dishId: pho, qty: 10 },
          { dishId: bun, qty: 10 },
        ],
      },
    })
  ).body as OrderDto;
  await c.orders.pay({
    params: { id: o.id },
    body: { version: o.version, print: false, payments: [{ method: 'CASH', amount: o.total }] },
  });
  const today = await businessToday();
  return { admin, staff, c, beef, onion, pho, bun, today };
}

const beefLeft = async (id: number) =>
  (await prisma.lot.findMany({ where: { ingredientId: id } })).reduce(
    (s, l) => s + Number(l.qtyRemaining),
    0,
  );

describe('stocktake', () => {
  it('book qty, 1 kg short → 120.000 split 60.000 / 60.000 over phở and bún', async () => {
    const { c, staff, beef, pho, bun, today } = await setup();
    const created = await staff.client.stocktake.create({ body: { date: today, note: null } });
    expect(created.status).toBe(201);
    const st = created.body as StocktakeDetail;
    expect(st.items.find((i) => i.ingredientId === beef.id)!.bookQty).toBe('6');
    expect(st).not.toHaveProperty('lossTotal');

    await staff.client.stocktake.update({
      params: { id: st.id },
      body: { note: 'Cuối tháng', items: [{ ingredientId: beef.id, actualQty: '5' }] },
    });
    expect((await staff.client.stocktake.complete({ params: { id: st.id }, body: {} })).status).toBe(403);
    const done = await c.stocktake.complete({ params: { id: st.id }, body: {} });
    expect(done.status).toBe(200);
    const d = done.body as StocktakeDetail;
    expect(d.status).toBe('DONE');
    expect(d.lossTotal).toBe('120000');
    const alloc = Object.fromEntries(d.dishAllocations!.map((a) => [a.dishId, a.lossValue]));
    expect(alloc[pho]).toBe('60000');
    expect(alloc[bun]).toBe('60000');
    expect(await beefLeft(beef.id)).toBe(5);

    // Cancelling gives the kilo back and removes the allocation.
    const cancelled = await c.stocktake.cancel({ params: { id: st.id }, body: { reason: 'Đếm nhầm kho' } });
    expect(cancelled.status).toBe(200);
    expect(await beefLeft(beef.id)).toBe(6);
    expect(await prisma.stocktakeDishAllocation.count()).toBe(0);
  });

  it('a surplus becomes a lot at the last price; unused ingredients go to general loss', async () => {
    const { c, beef, onion, today } = await setup();
    const st = (await c.stocktake.create({ body: { date: today, note: null } })).body as StocktakeDetail;
    await c.stocktake.update({
      params: { id: st.id },
      body: {
        note: null,
        items: [
          { ingredientId: beef.id, actualQty: '7' },
          { ingredientId: onion.id, actualQty: '4.5' },
        ],
      },
    });
    const d = (await c.stocktake.complete({ params: { id: st.id }, body: {} })).body as StocktakeDetail;
    const beefRow = d.items.find((i) => i.ingredientId === beef.id)!;
    expect(beefRow).toMatchObject({ diffQty: '1', lossValue: '-120000' });
    expect(await beefLeft(beef.id)).toBe(7);
    const general = d.dishAllocations!.find((a) => a.dishId === null)!;
    expect(general.lossValue).toBe('10000');
  });

  it('only one draft at a time; a completed stocktake is read-only', async () => {
    const { c, beef, today } = await setup();
    const st = (await c.stocktake.create({ body: { date: today, note: null } })).body as StocktakeDetail;
    expect((await c.stocktake.create({ body: { date: today, note: null } })).status).toBe(409);
    await c.stocktake.update({
      params: { id: st.id },
      body: { note: null, items: [{ ingredientId: beef.id, actualQty: '6' }] },
    });
    await c.stocktake.complete({ params: { id: st.id }, body: {} });
    const again = await c.stocktake.update({
      params: { id: st.id },
      body: { note: null, items: [{ ingredientId: beef.id, actualQty: '1' }] },
    });
    expect(again.status).toBe(409);
  });
});
