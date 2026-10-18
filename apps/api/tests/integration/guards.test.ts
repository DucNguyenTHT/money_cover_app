// Changes that would make stored figures lie: refused, with a message saying what to do instead.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/core/db';
import { toDbDate } from '../../src/domain/business-date';
import { businessToday } from '../../src/modules/settings/settings.service';
import { makeUser, resetDb, startServer, stopServer } from '../helpers/harness';
import { branchId, makeIngredient } from '../helpers/factories';

beforeAll(startServer);
afterAll(stopServer);
beforeEach(resetDb);

const shift = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400_000).toISOString().slice(0, 10);

async function dishWithSale(saleDate: string) {
  const { client, user } = await makeUser({ username: 'chu', role: 'ADMIN' });
  const cat = await prisma.dishCategory.create({ data: { name: 'Món' } });
  const dish = await prisma.dish.create({ data: { code: 'M1', name: 'Phở', categoryId: cat.id } });
  await prisma.dishPrice.create({
    data: { dishId: dish.id, priceType: 'STORE', price: 50000, effectiveFrom: toDbDate('2026-01-01') },
  });
  await prisma.order.create({
    data: {
      branchId: await branchId(),
      code: 'D1',
      businessDate: toDbDate(saleDate),
      channel: 'TAKEAWAY',
      status: 'PAID',
      openedById: user.id,
      items: {
        create: { dishId: dish.id, station: 'KITCHEN', qty: 1, unitPrice: 50000, amount: 50000 },
      },
    },
  });
  return { client, dishId: dish.id };
}

describe('ingredient units', () => {
  it('can change while unused, not once it has stock', async () => {
    const { client } = await makeUser({ username: 'chu', role: 'ADMIN' });
    const ing = await makeIngredient({ name: 'Thịt bò' });
    const body = {
      code: ing.code,
      name: ing.name,
      kind: 'INGREDIENT' as const,
      unit: 'g',
      recipeUnit: 'g',
      recipeFactor: '1',
      purchaseUnit: null,
      purchaseFactor: '1',
      category: null,
      active: true,
    };
    const free = await client.catalog.updateIngredient({ params: { id: ing.id }, body });
    expect(free.status).toBe(200);
    expect(free.body).toMatchObject({ unit: 'g', unitsLocked: false });

    await prisma.lot.create({
      data: {
        branchId: await branchId(),
        ingredientId: ing.id,
        date: toDbDate('2026-01-01'),
        unitPrice: 300,
        qtyIn: 12500,
        qtyRemaining: 12500,
      },
    });
    const locked = await client.catalog.updateIngredient({
      params: { id: ing.id },
      body: { ...body, unit: 'kg', recipeFactor: '1000' },
    });
    expect(locked.status).toBe(409);
    // Other fields still save.
    const renamed = await client.catalog.updateIngredient({
      params: { id: ing.id },
      body: { ...body, name: 'Thịt bò Úc' },
    });
    expect(renamed.body).toMatchObject({ name: 'Thịt bò Úc', unitsLocked: true });
  });
});

describe('tables', () => {
  it('a table with an unpaid order cannot be hidden', async () => {
    const { client } = await makeUser({ username: 'chu', role: 'ADMIN' });
    const area = (await client.venue.createArea({ body: { name: 'Tầng 1', sort: 1 } })).body as {
      id: number;
    };
    const body = { areaId: area.id, name: 'Bàn 1', seats: 4, sort: 1, active: true };
    const t = (await client.venue.createTable({ body })).body as { id: number };
    await client.orders.open({
      body: {
        channel: 'DINE_IN',
        tableId: t.id,
        deliveryAppId: null,
        appOrderCode: null,
        guestCount: 2,
        note: null,
        items: [],
      },
    });
    const res = await client.venue.updateTable({ params: { id: t.id }, body: { ...body, active: false } });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain('Bàn 1 đang có đơn chưa thanh toán');
  });
});

describe('backdated price and recipe', () => {
  it('refused once the dish has sold since that date; today and a date before any sale are fine', async () => {
    const today = await businessToday();
    const { client, dishId } = await dishWithSale(shift(today, -3));

    const price = (effectiveFrom: string) =>
      client.menu.setPrice({
        params: { id: dishId },
        body: { priceType: 'STORE', price: '55000', effectiveFrom },
      });
    expect((await price(shift(today, -5))).status).toBe(409);
    expect((await price(shift(today, -2))).status).toBe(200);
    expect((await price(today)).status).toBe(200);

    const ing = await makeIngredient();
    const recipe = (effectiveFrom: string) =>
      client.menu.saveRecipe({
        params: { id: dishId },
        body: { effectiveFrom, note: null, items: [{ ingredientId: ing.id, qty: '100', scope: 'ALL' }] },
      });
    const old = await recipe(shift(today, -10));
    expect(old.status).toBe(409);
    expect(JSON.stringify(old.body)).toContain('định mức mới chỉ áp dụng được từ hôm nay');
    expect((await recipe(today)).status).toBe(200);
  });
});

describe('orders left open', () => {
  it('the dashboard counts open orders from earlier business days', async () => {
    const { client, user } = await makeUser({ username: 'chu', role: 'ADMIN' });
    const today = await businessToday();
    for (const [code, date] of [
      ['O1', shift(today, -2)],
      ['O2', today],
    ] as const)
      await prisma.order.create({
        data: {
          branchId: await branchId(),
          code,
          businessDate: toDbDate(date),
          channel: 'TAKEAWAY',
          status: 'OPEN',
          openedById: user.id,
        },
      });
    const d = await client.reports.dashboard();
    expect(d.body).toMatchObject({ alerts: { staleOpenOrders: 1 } });
  });
});
