import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/core/db';
import { businessToday } from '../../src/modules/settings/settings.service';
import { toDbDate } from '../../src/domain/business-date';
import { makeUser, resetDb, startServer, stopServer } from '../helpers/harness';
import { branchId, makeIngredient } from '../helpers/factories';

beforeAll(startServer);
afterAll(stopServer);
beforeEach(resetDb);

async function setupPho() {
  const admin = await makeUser({ username: 'quanly', role: 'ADMIN' });
  const c = admin.client;
  const cat = await c.menu.createCategory({
    body: { name: 'Món nước', foodCostTarget: '35', station: 'KITCHEN', sort: 1 },
  });
  const catId = (cat.body as { id: number }).id;
  const beef = await makeIngredient({ name: 'Thịt bò' });
  const noodle = await makeIngredient({ name: 'Bánh phở' });
  const box = await makeIngredient({ name: 'Hộp giấy', unit: 'cái', kind: 'PACKAGING' });
  const bid = await branchId();
  for (const [ing, price] of [
    [beef, 120000],
    [noodle, 20000],
    [box, 2000],
  ] as const) {
    await prisma.lot.create({
      data: {
        branchId: bid,
        ingredientId: ing.id,
        date: toDbDate('2026-01-01'),
        unitPrice: price,
        qtyIn: 100,
        qtyRemaining: 100,
      },
    });
  }
  await c.venue.createDeliveryApp({ body: { name: 'Grab', commissionPct: '25', active: true } });
  await c.settings.update({ body: { settings: { overhead_rate_mode: 'MANUAL', overhead_rate_manual: 10 } } });
  const dish = await c.menu.createDish({
    body: {
      code: 'PHO',
      name: 'Phở bò',
      categoryId: catId,
      active: true,
      sort: 1,
      storePrice: '80000',
      appPrice: '114000',
    },
  });
  const dishId = (dish.body as { id: number }).id;
  const today = await businessToday();
  const recipe = await c.menu.saveRecipe({
    params: { id: dishId },
    body: {
      effectiveFrom: '2026-01-01',
      note: null,
      items: [
        { ingredientId: beef.id, qty: '200', scope: 'ALL' },
        { ingredientId: noodle.id, qty: '200', scope: 'ALL' },
        { ingredientId: box.id, qty: '1', scope: 'TAKEAWAY_APP' },
      ],
    },
  });
  return { admin, c, dishId, today, recipe, beef, catId };
}

describe('menu', () => {
  it('stores recipe quantities in stock units and returns them in recipe units', async () => {
    const { recipe } = await setupPho();
    expect(recipe.status).toBe(200);
    const items = (recipe.body as { recipes: { items: { qty: string; recipeUnit: string }[] }[] }).recipes[0]!
      .items;
    expect(items[0]).toMatchObject({ qty: '200', recipeUnit: 'g' });
    const stored = await prisma.dishRecipeItem.findFirstOrThrow({ orderBy: { id: 'asc' } });
    expect(stored.qty.toString()).toBe('0.2');
  });

  it('applies a new price only from its effective date', async () => {
    const { c, dishId, today } = await setupPho();
    const future = new Date(Date.parse(today) + 3 * 86400_000).toISOString().slice(0, 10);
    await c.menu.setPrice({
      params: { id: dishId },
      body: { priceType: 'STORE', price: '85000', effectiveFrom: future },
    });
    const now = (await c.menu.listDishes({ query: {} })).body as { storePrice: string }[];
    expect(now[0]!.storePrice).toBe('80000');
    const later = (await c.menu.listDishes({ query: { date: future } })).body as { storePrice: string }[];
    expect(later[0]!.storePrice).toBe('85000');
  });

  it('sold-out flag only lasts for the current business day', async () => {
    const { c, dishId } = await setupPho();
    const res = await c.menu.setAvailability({ params: { id: dishId }, body: { soldOut: true } });
    expect(res.body).toMatchObject({ soldOut: true });
    await prisma.dish.update({ where: { id: dishId }, data: { soldOutDate: toDbDate('2020-01-01') } });
    const list = (await c.menu.listDishes({ query: {} })).body as { soldOut: boolean }[];
    expect(list[0]!.soldOut).toBe(false);
  });

  it('staff can read the menu and toggle sold-out but not edit prices', async () => {
    const { dishId } = await setupPho();
    const staff = await makeUser({ username: 'thungan', role: 'STAFF' });
    expect((await staff.client.menu.listDishes({ query: {} })).status).toBe(200);
    expect(
      (await staff.client.menu.setAvailability({ params: { id: dishId }, body: { soldOut: true } })).status,
    ).toBe(200);
    expect(
      (
        await staff.client.menu.setPrice({
          params: { id: dishId },
          body: { priceType: 'STORE', price: '1', effectiveFrom: '2026-01-02' },
        })
      ).status,
    ).toBe(403);
    expect((await staff.client.pricing.list({ query: {} })).status).toBe(403);
  });
});

describe('pricing', () => {
  it('cost sheet matches the plan example (28.000 → 80.000 / 114.000, profit 44.000)', async () => {
    const { c, dishId } = await setupPho();
    const res = await c.pricing.detail({ params: { id: dishId }, query: {} });
    expect(res.status).toBe(200);
    const { row, context } = res.body as unknown as {
      row: Record<string, never>;
      context: { overheadPct: string; app: { name: string } };
    };
    expect(context).toMatchObject({ overheadPct: '10', app: { name: 'Grab' } });
    expect(row).toMatchObject({
      suggestedStorePrice: '80000',
      suggestedAppPrice: '114000',
      alert: null,
      channels: {
        DINE_IN: { directCost: '28000', profit: '44000', foodCostPct: '35' },
        TAKEAWAY: { directCost: '30000' },
        APP: { directCost: '30000', commission: '28500', profit: '44100' },
      },
    });
  });

  it('a price increase that makes the dish lose money shows up as a LOSS alert', async () => {
    const { c, beef } = await setupPho();
    await prisma.lot.create({
      data: {
        branchId: await branchId(),
        ingredientId: beef.id,
        date: toDbDate('2026-02-01'),
        unitPrice: 450000,
        qtyIn: 1,
        qtyRemaining: 1,
      },
    });
    const alerts = (await c.pricing.alerts()).body as { name: string; alert: string }[];
    expect(alerts).toEqual([expect.objectContaining({ name: 'Phở bò', alert: 'LOSS' })]);
  });
});

describe('overheads', () => {
  it('saves a month and refuses changes to a locked month', async () => {
    const { client, user } = await makeUser({ username: 'quanly', role: 'ADMIN' });
    const res = await client.overheads.saveMonth({
      params: { year: 2026, month: 9 },
      body: {
        lines: [
          { category: 'Mặt bằng', amount: '15000000', note: null },
          { category: 'Điện', amount: '3000000', note: null },
        ],
      },
    });
    expect(res.body).toMatchObject({ total: '18000000' });
    await prisma.periodLock.create({
      data: { branchId: await branchId(), year: 2026, month: 9, lockedById: user.id },
    });
    expect(
      (await client.overheads.saveMonth({ params: { year: 2026, month: 9 }, body: { lines: [] } })).status,
    ).toBe(409);
  });
});
