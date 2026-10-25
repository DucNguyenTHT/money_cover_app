import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/core/db';
import { toDbDate } from '../../src/domain/business-date';
import { businessToday } from '../../src/modules/settings/settings.service';
import type { OrderDto } from '../../src/contracts/orders.contract';
import type { ProductionDto, SemiDto } from '../../src/contracts/production.contract';
import { makeUser, resetDb, startServer, stopServer } from '../helpers/harness';
import { branchId, makeIngredient } from '../helpers/factories';

beforeAll(startServer);
afterAll(stopServer);
beforeEach(resetDb);

type Client = Awaited<ReturnType<typeof makeUser>>['client'];

/** Bones 100.000/kg, spices 200.000/kg, beef 300.000/kg; "Nước dùng bò" (litre, recipe in ml); phở = 0,4 l broth + 0,1 kg beef. */
async function setup() {
  const admin = await makeUser({ username: 'chu', role: 'ADMIN' });
  const staff = await makeUser({ username: 'bep', role: 'STAFF' });
  const c = admin.client;
  const bid = await branchId();
  const lot = (ingredientId: number, qty: number, unitPrice: number) =>
    prisma.lot.create({
      data: {
        branchId: bid,
        ingredientId,
        date: toDbDate('2026-01-01'),
        unitPrice,
        qtyIn: qty,
        qtyRemaining: qty,
      },
    });
  const bones = await makeIngredient({ name: 'Xương bò' });
  const spice = await makeIngredient({ name: 'Gia vị nước dùng' });
  const beef = await makeIngredient({ name: 'Thịt bò' });
  await lot(bones.id, 30, 100000);
  await lot(spice.id, 2, 200000);
  await lot(beef.id, 10, 300000);
  const broth = await prisma.ingredient.create({
    data: {
      code: 'BTP1',
      name: 'Nước dùng bò',
      kind: 'SEMI',
      unit: 'lít',
      recipeUnit: 'ml',
      recipeFactor: 1000,
    },
  });
  const cat = (
    await c.menu.createCategory({
      body: { name: 'Món nước', foodCostTarget: null, station: 'KITCHEN', sort: 1 },
    })
  ).body as { id: number };
  const pho = (
    await c.menu.createDish({
      body: {
        code: 'PHO',
        name: 'Phở bò',
        categoryId: cat.id,
        active: true,
        sort: 1,
        storePrice: '60000',
        appPrice: null,
      },
    })
  ).body as { id: number };
  await c.menu.saveRecipe({
    params: { id: pho.id },
    body: {
      effectiveFrom: '2026-01-01',
      note: null,
      items: [
        { ingredientId: broth.id, qty: '400', scope: 'ALL' },
        { ingredientId: beef.id, qty: '100', scope: 'ALL' },
      ],
    },
  });
  return { admin, staff, bones, spice, beef, broth, pho: pho.id };
}

async function sell(c: Client, dishId: number, qty: number) {
  const o = (
    await c.orders.open({
      body: {
        channel: 'TAKEAWAY',
        tableId: null,
        deliveryAppId: null,
        appOrderCode: null,
        guestCount: 1,
        note: null,
        items: [{ dishId, qty }],
      },
    })
  ).body as OrderDto;
  const r = await c.orders.pay({
    params: { id: o.id },
    body: { version: o.version, payments: [{ method: 'CASH', amount: o.total }], print: false },
  });
  return (r.body as { order: OrderDto }).order;
}

const stockOf = async (ingredientId: number) =>
  (await prisma.lot.findMany({ where: { ingredientId } })).reduce((s, l) => s + Number(l.qtyRemaining), 0);

describe('semi-finished goods (bán thành phẩm)', () => {
  it('a batch recipe prices the broth; dishes using it are priced from the latest input prices', async () => {
    const { admin, staff, bones, spice, broth, pho } = await setup();
    const recipe = {
      effectiveFrom: '2026-01-01',
      yieldQty: '40',
      note: 'Nồi 50 lít',
      items: [
        { ingredientId: bones.id, qty: '10' },
        { ingredientId: spice.id, qty: '0.5' },
      ],
    };
    expect(
      (await staff.client.production.saveRecipe({ params: { id: broth.id }, body: recipe })).status,
    ).toBe(403);
    expect(
      (await admin.client.production.saveRecipe({ params: { id: broth.id }, body: recipe })).status,
    ).toBe(200);
    // Broth cannot go into broth; an ingredient cannot get a batch recipe.
    expect(
      (
        await admin.client.production.saveRecipe({
          params: { id: broth.id },
          body: { ...recipe, items: [{ ingredientId: broth.id, qty: '1' }] },
        })
      ).status,
    ).toBe(400);
    expect(
      (await admin.client.production.saveRecipe({ params: { id: bones.id }, body: recipe })).status,
    ).toBe(400);

    const semis = (await admin.client.production.semis()).body as SemiDto[];
    // (10 × 100.000 + 0,5 × 200.000) ÷ 40 = 27.500 per litre.
    expect(semis[0]).toMatchObject({
      name: 'Nước dùng bò',
      theoreticalUnitCost: '27500',
      lastUnitCost: null,
    });
    const staffView = (await staff.client.production.semis()).body as SemiDto[];
    expect(staffView[0]!.theoreticalUnitCost).toBeUndefined();

    // Phở: 0,4 l × 27.500 + 0,1 kg × 300.000 = 41.000.
    const detail = (await admin.client.pricing.detail({ params: { id: pho }, query: {} })).body as {
      row: { channels: { DINE_IN: { ingredientCost: string } } };
    };
    expect(detail.row.channels.DINE_IN.ingredientCost).toBe('41000');

    // A plan for a 60-litre pot.
    const plan = await staff.client.production.plan({
      body: { ingredientId: broth.id, qty: '60', date: '2026-01-02' },
    });
    expect(plan.body).toMatchObject({
      inputs: [
        { ingredientId: bones.id, qty: '15' },
        { ingredientId: spice.id, qty: '0.75' },
      ],
    });
  });

  it('cooking takes the inputs out and puts a lot of broth in at their real cost; sales before it get that cost', async () => {
    const { admin, staff, bones, spice, broth, pho } = await setup();
    const today = await businessToday();
    // Sold before the morning pot was recorded: broth owed ("nợ kho").
    const o = await sell(staff.client, pho, 10);
    const pendingBefore = await prisma.issueItem.findFirstOrThrow({ where: { ingredientId: broth.id } });
    expect(pendingBefore.pendingQty.toString()).toBe('4');

    // Too many bones: refused, nothing written.
    const tooMuch = await staff.client.production.create({
      body: {
        date: today,
        ingredientId: broth.id,
        qty: '40',
        note: null,
        inputs: [{ ingredientId: bones.id, qty: '100' }],
      },
    });
    expect(tooMuch.status).toBe(400);
    expect(JSON.stringify(tooMuch.body)).toContain('Không đủ tồn kho');

    const made = await staff.client.production.create({
      body: {
        date: today,
        ingredientId: broth.id,
        qty: '38',
        note: 'Nồi sáng',
        inputs: [
          { ingredientId: bones.id, qty: '10' },
          { ingredientId: spice.id, qty: '0.5' },
        ],
      },
    });
    expect(made.status).toBe(201);
    const p = made.body as ProductionDto;
    expect(p.costTotal).toBeUndefined(); // staff never see costs
    const full = (await admin.client.production.list({ query: { month: today.slice(0, 7) } }))
      .body as ProductionDto[];
    // 1.100.000 for 38 litres.
    expect(full[0]).toMatchObject({ qty: '38', costTotal: '1100000', unitCost: '28947.3684', used: true });
    expect(await stockOf(bones.id)).toBe(20);
    expect(await stockOf(spice.id)).toBeCloseTo(1.5);
    expect(await stockOf(broth.id)).toBe(34); // 38 − the 4 litres owed

    // The phở sold earlier now costs 4 l at the batch price + 1 kg beef.
    const after = (await admin.client.orders.get({ params: { id: o.id } })).body as OrderDto;
    expect(Number(after.costTotal)).toBe(Math.round(4 * 28947.3684) + 300000);

    // Used already: cannot be deleted. The production issue cannot be deleted on its own either.
    expect(
      (await admin.client.production.remove({ params: { id: p.id }, body: { reason: 'Ghi nhầm số' } }))
        .status,
    ).toBe(409);
    const issue = await prisma.issue.findFirstOrThrow({ where: { reason: 'PRODUCTION' } });
    expect(
      (
        await admin.client.inventory.deleteIssue({
          params: { id: issue.id },
          body: { reason: 'Xoá thử xem' },
        })
      ).status,
    ).toBe(400);
  });

  it('an unused batch can be deleted (inputs come back); broth is cooked, not bought; the stock report shows both sides', async () => {
    const { admin, staff, bones, spice, broth } = await setup();
    const today = await businessToday();
    const p = (
      await staff.client.production.create({
        body: {
          date: today,
          ingredientId: broth.id,
          qty: '40',
          note: null,
          inputs: [
            { ingredientId: bones.id, qty: '10' },
            { ingredientId: spice.id, qty: '0.5' },
          ],
        },
      })
    ).body as ProductionDto;

    const report = (await admin.client.reports.stockMovement({ query: { from: today, to: today } })).body as {
      rows: {
        name: string;
        produced: { qty: string; value: string };
        usedInProduction: { qty: string; value: string };
        closing: { qty: string };
      }[];
    };
    const row = (n: string) => report.rows.find((r) => r.name === n)!;
    expect(row('Nước dùng bò')).toMatchObject({
      produced: { qty: '40', value: '1100000' },
      closing: { qty: '40' },
    });
    expect(row('Xương bò').usedInProduction).toEqual({ qty: '10', value: '1000000' });

    // Bought broth: refused; opening stock of broth: fine.
    const bought = await admin.client.inventory.createReceipt({
      body: {
        kind: 'PURCHASE',
        date: today,
        supplier: 'Chợ',
        note: null,
        items: [{ ingredientId: broth.id, qty: '5', unitPrice: '30000', unitMode: 'STOCK' }],
      },
    });
    expect(bought.status).toBe(400);
    expect(JSON.stringify(bought.body)).toContain('phiếu chế biến');

    expect(
      (await admin.client.production.remove({ params: { id: p.id }, body: { reason: 'Ghi nhầm mẻ' } }))
        .status,
    ).toBe(200);
    expect(await stockOf(bones.id)).toBe(30);
    expect(await stockOf(broth.id)).toBe(0);
    expect(await prisma.issue.count({ where: { reason: 'PRODUCTION' } })).toBe(0);
  });
});
