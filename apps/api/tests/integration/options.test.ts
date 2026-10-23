import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/core/db';
import { toDbDate } from '../../src/domain/business-date';
import { businessToday } from '../../src/modules/settings/settings.service';
import type { OptionGroupDto } from '../../src/contracts/menu.contract';
import type { OrderDto } from '../../src/contracts/orders.contract';
import type { PricingDetail, PricingRow } from '../../src/contracts/pricing.contract';
import { makeUser, resetDb, startServer, stopServer } from '../helpers/harness';
import { branchId, makeIngredient } from '../helpers/factories';

beforeAll(startServer);
afterAll(stopServer);
beforeEach(resetDb);

const opt = (name: string, price: string, extra: Record<string, unknown> = {}) => ({
  id: null,
  name,
  price,
  recipeFactor: '1',
  isDefault: false,
  active: true,
  sort: 0,
  ingredients: [] as { ingredientId: number; qty: string }[],
  ...extra,
});

async function setup() {
  const admin = await makeUser({ username: 'quanly', role: 'ADMIN' });
  const staff = await makeUser({ username: 'thungan', role: 'STAFF' });
  const c = admin.client;
  const cat = (
    await c.menu.createCategory({
      body: { name: 'Món nước', foodCostTarget: null, station: 'KITCHEN', sort: 1 },
    })
  ).body as { id: number };
  const beef = await makeIngredient({ name: 'Thịt bò' });
  const box = await makeIngredient({ name: 'Hộp', unit: 'cái', kind: 'PACKAGING' });
  const egg = await makeIngredient({ name: 'Trứng', unit: 'quả' });
  const bid = await branchId();
  for (const [ing, qty, price] of [
    [beef, 10, 200000],
    [box, 50, 2000],
    [egg, 30, 3000],
  ] as const)
    await prisma.lot.create({
      data: {
        branchId: bid,
        ingredientId: ing.id,
        date: toDbDate('2026-01-01'),
        unitPrice: price,
        qtyIn: qty,
        qtyRemaining: qty,
      },
    });
  const pho = (
    await c.menu.createDish({
      body: {
        code: 'PHO',
        name: 'Phở bò',
        categoryId: cat.id,
        active: true,
        sort: 1,
        storePrice: '50000',
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
        { ingredientId: beef.id, qty: '200', scope: 'ALL' },
        { ingredientId: box.id, qty: '1', scope: 'TAKEAWAY_APP' },
      ],
    },
  });

  const group = async (body: Record<string, unknown>) =>
    (await c.menu.createOptionGroup({ body: body as never })).body as OptionGroupDto;
  const size = await group({
    name: 'Size',
    multi: false,
    required: true,
    maxSelect: null,
    sort: 1,
    active: true,
    options: [opt('Vừa', '0', { isDefault: true }), opt('Lớn', '10000', { recipeFactor: '1.5', sort: 1 })],
  });
  const extra = await group({
    name: 'Thêm',
    multi: true,
    required: false,
    maxSelect: 2,
    sort: 2,
    active: true,
    options: [
      opt('Trứng', '5000', { ingredients: [{ ingredientId: egg.id, qty: '1' }] }),
      opt('Quẩy', '3000'),
    ],
  });
  const request = await group({
    name: 'Yêu cầu',
    multi: true,
    required: false,
    maxSelect: null,
    sort: 3,
    active: true,
    options: [opt('Ít cay', '0')],
  });
  await c.menu.setDishOptionGroups({
    params: { id: pho.id },
    body: { groupIds: [size.id, extra.id, request.id] },
  });
  const id = (g: OptionGroupDto, name: string) => g.options.find((o) => o.name === name)!.id;
  return {
    c,
    staff: staff.client,
    pho: pho.id,
    beef,
    box,
    egg,
    size,
    extra,
    o: {
      vua: id(size, 'Vừa'),
      lon: id(size, 'Lớn'),
      trung: id(extra, 'Trứng'),
      quay: id(extra, 'Quẩy'),
      itCay: id(request, 'Ít cay'),
    },
  };
}

type S = Awaited<ReturnType<typeof setup>>;

const open = async (
  s: S,
  items: { dishId: number; qty: number; optionIds?: number[] }[],
  channel = 'TAKEAWAY',
) => {
  const res = await s.c.orders.open({
    body: {
      channel: channel as 'TAKEAWAY',
      tableId: null,
      deliveryAppId: null,
      appOrderCode: null,
      guestCount: 1,
      note: null,
      items,
    },
  });
  return res;
};

const remaining = async (ingredientId: number) =>
  (await prisma.lot.findMany({ where: { ingredientId } })).reduce(
    (sum, l) => sum + Number(l.qtyRemaining),
    0,
  );

describe('option groups', () => {
  it('are managed by ADMIN, read by staff, attached to dishes', async () => {
    const s = await setup();
    expect(s.size.options.map((o) => o.name)).toEqual(['Vừa', 'Lớn']);
    expect(s.extra.options[0]!.ingredients[0]).toMatchObject({ ingredientName: 'Trứng', qty: '1' });
    expect((await s.staff.menu.listOptionGroups()).status).toBe(200);
    const bad = await s.c.menu.createOptionGroup({
      body: {
        name: 'Size 2',
        multi: false,
        required: true,
        maxSelect: null,
        sort: 1,
        active: true,
        options: [opt('A', '0', { isDefault: true }), opt('B', '0', { isDefault: true })],
      },
    });
    expect(bad.status).toBe(400);
    expect(
      (await s.staff.menu.createOptionGroup({ body: { ...s.size, options: [opt('X', '0')] } })).status,
    ).toBe(403);
    const [dish] = (await s.c.menu.listDishes({ query: {} })).body as { optionGroupIds: number[] }[];
    expect(dish!.optionGroupIds).toHaveLength(3);
  });
});

describe('ordering with options', () => {
  it('prices each line, merges equal lines, refuses an invalid choice', async () => {
    const s = await setup();
    const res = await open(s, [
      { dishId: s.pho, qty: 1 }, // defaults: Vừa
      { dishId: s.pho, qty: 1, optionIds: [s.o.lon, s.o.trung, s.o.itCay] },
      { dishId: s.pho, qty: 1, optionIds: [s.o.vua] }, // same as the first line
    ]);
    expect(res.status).toBe(201);
    const o = res.body as OrderDto;
    expect(o.items).toHaveLength(2);
    expect(o.items[0]).toMatchObject({ qty: 2, basePrice: '50000', unitPrice: '50000' });
    expect(o.items[0]!.options.map((x) => x.name)).toEqual(['Vừa']);
    expect(o.items[1]).toMatchObject({ qty: 1, unitPrice: '65000' });
    expect(o.items[1]!.options.map((x) => `${x.groupName}:${x.name}`)).toEqual([
      'Size:Lớn',
      'Thêm:Trứng',
      'Yêu cầu:Ít cay',
    ]);
    expect(o.subtotal).toBe('165000');

    const missing = await open(s, [{ dishId: s.pho, qty: 1, optionIds: [s.o.trung] }]);
    expect(missing.status).toBe(400);
    expect(JSON.stringify(missing.body)).toContain('Phở bò: Chọn Size');
  });

  it('options of a line can change until it goes to the kitchen; the kitchen sees them', async () => {
    const s = await setup();
    let o = (await open(s, [{ dishId: s.pho, qty: 1 }])).body as OrderDto;
    const line = o.items[0]!;
    o = (
      await s.c.orders.updateItem({
        params: { id: o.id, itemId: line.id },
        body: { version: o.version, optionIds: [s.o.lon, s.o.quay] },
      })
    ).body as OrderDto;
    expect(o.items[0]).toMatchObject({ unitPrice: '63000' });
    expect(o.total).toBe('63000');

    o = (
      (await s.c.orders.sendKitchen({ params: { id: o.id }, body: { version: o.version } })).body as {
        order: OrderDto;
      }
    ).order;
    const queue = (await s.c.kitchen.queue({ query: { station: 'KITCHEN' } })).body as { options: string }[];
    expect(queue[0]!.options).toBe('Lớn · Quẩy');
    const late = await s.c.orders.updateItem({
      params: { id: o.id, itemId: line.id },
      body: { version: o.version, optionIds: [s.o.vua] },
    });
    expect(late.status).toBe(409);
  });

  it('stock: size multiplies the recipe (not the box), toppings add their ingredients', async () => {
    const s = await setup();
    const o = (
      await open(s, [
        { dishId: s.pho, qty: 2, optionIds: [s.o.lon, s.o.trung] },
        { dishId: s.pho, qty: 1 },
      ])
    ).body as OrderDto;
    const paid = await s.c.orders.pay({
      params: { id: o.id },
      body: {
        version: o.version,
        payments: [{ method: 'CASH', amount: o.total, cashReceived: null }],
        print: false,
      },
    });
    expect(paid.status).toBe(200);
    // Beef: 2 × 0,2 kg × 1,5 + 1 × 0,2 kg = 0,8 kg; boxes: 3; eggs: 2.
    expect(await remaining(s.beef.id)).toBeCloseTo(9.2);
    expect(await remaining(s.box.id)).toBe(47);
    expect(await remaining(s.egg.id)).toBe(28);
    const lines = (paid.body as { order: OrderDto }).order.items;
    // Big bowl with eggs: 0,6 kg × 200.000 + 2 boxes × 2.000 + 2 eggs × 3.000.
    expect(lines[0]!.costTotal).toBe('130000');
  });

  it('a split line keeps its options; renaming an option later does not change sold orders', async () => {
    const s = await setup();
    const o = (await open(s, [{ dishId: s.pho, qty: 2, optionIds: [s.o.lon, s.o.trung] }])).body as OrderDto;
    const split = await s.c.orders.split({
      params: { id: o.id },
      body: { version: o.version, lines: [{ itemId: o.items[0]!.id, qty: 1 }], tableId: null },
    });
    const { source, created } = split.body as { source: OrderDto; created: OrderDto };
    expect(created.items[0]!.options.map((x) => x.name)).toEqual(['Lớn', 'Trứng']);
    expect(created.items[0]!.unitPrice).toBe('65000');
    expect(source.items[0]!.qty).toBe(1);

    await s.c.menu.updateOptionGroup({
      params: { id: s.extra.id },
      body: {
        ...s.extra,
        options: [{ ...s.extra.options[0]!, name: 'Trứng gà', ingredients: [] }],
      },
    });
    const again = (await s.c.orders.get({ params: { id: created.id } })).body as OrderDto;
    expect(again.items[0]!.options.map((x) => x.name)).toEqual(['Lớn', 'Trứng']);
    // "Quẩy" was left out: never sold, so deleted; "Trứng" was sold, so it is kept (renamed).
    const groups = (await s.c.menu.listOptionGroups()).body as OptionGroupDto[];
    expect(groups.find((g) => g.id === s.extra.id)!.options.map((x) => x.name)).toEqual(['Trứng gà']);
  });

  it('the sales report lists the options sold', async () => {
    const s = await setup();
    const o = (
      await open(s, [
        { dishId: s.pho, qty: 3, optionIds: [s.o.lon, s.o.trung] },
        { dishId: s.pho, qty: 1 },
      ])
    ).body as OrderDto;
    await s.c.orders.pay({
      params: { id: o.id },
      body: {
        version: o.version,
        payments: [{ method: 'CASH', amount: o.total, cashReceived: null }],
        print: false,
      },
    });
    const today = await businessToday();
    const r = (await s.c.reports.sales({ query: { from: today, to: today } })).body as {
      topOptions: { groupName: string; name: string; qty: number; amount: string }[];
    };
    expect(r.topOptions).toEqual(
      expect.arrayContaining([
        { groupName: 'Size', name: 'Lớn', qty: 3, amount: '30000' },
        { groupName: 'Thêm', name: 'Trứng', qty: 3, amount: '15000' },
        { groupName: 'Size', name: 'Vừa', qty: 1, amount: '0' },
      ]),
    );
  });
});

describe('stocktake with options', () => {
  it('a shortage of a topping ingredient is charged to the dishes that used it', async () => {
    const s = await setup();
    const o = (await open(s, [{ dishId: s.pho, qty: 2, optionIds: [s.o.lon, s.o.trung] }])).body as OrderDto;
    await s.c.orders.pay({
      params: { id: o.id },
      body: {
        version: o.version,
        payments: [{ method: 'CASH', amount: o.total, cashReceived: null }],
        print: false,
      },
    });
    const today = await businessToday();
    const st = (await s.c.stocktake.create({ body: { date: today, note: null } })).body as { id: number };
    // Book stock: 30 − 2 eggs = 28; counted 26 → 2 eggs short (2 × 3.000).
    await s.c.stocktake.update({
      params: { id: st.id },
      body: { note: null, items: [{ ingredientId: s.egg.id, actualQty: '26' }] },
    });
    const done = (await s.c.stocktake.complete({ params: { id: st.id }, body: {} })).body as {
      dishAllocations: { dishId: number | null; lossValue: string }[];
    };
    expect(done.dishAllocations).toEqual([expect.objectContaining({ dishId: s.pho, lossValue: '6000' })]);
  });
});

describe('pricing with options', () => {
  it('the cost sheet and price alerts show what each option earns', async () => {
    const s = await setup();
    const d = (await s.c.pricing.detail({ params: { id: s.pho }, query: {} })).body as { row: PricingDetail };
    const by = (name: string) => d.row.options.find((o) => o.name === name)!;
    // 200 g beef at 200.000/kg = 40.000 a portion; large = ×1.5 for 10.000 more.
    expect(by('Lớn')).toMatchObject({
      kind: 'SIZE',
      extraCost: '20000',
      price: '60000',
      cost: '60000',
      alert: 'LOSS',
    });
    expect(by('Trứng')).toMatchObject({
      kind: 'ADDON',
      price: '5000',
      cost: '3000',
      foodCostPct: '60',
      alert: 'OVER_TARGET',
    });
    expect(by('Quẩy')).toMatchObject({ cost: '0', alert: null });
    expect(by('Ít cay')).toMatchObject({ price: '0', alert: null });
    expect(d.row.optionAlert).toBe('LOSS');
    const alerts = (await s.c.pricing.alerts()).body as PricingRow[];
    expect(alerts.map((r) => [r.name, r.optionAlert])).toEqual([['Phở bò', 'LOSS']]);
  });
});
