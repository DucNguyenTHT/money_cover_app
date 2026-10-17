import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/core/db';
import { toDbDate } from '../../src/domain/business-date';
import { businessToday } from '../../src/modules/settings/settings.service';
import type { OrderDto } from '../../src/contracts/orders.contract';
import { makeUser, resetDb, startServer, stopServer } from '../helpers/harness';
import { branchId, makeIngredient } from '../helpers/factories';

beforeAll(startServer);
afterAll(stopServer);
beforeEach(resetDb);

const PIN = '2580';

async function setup() {
  const admin = await makeUser({ username: 'quanly', role: 'ADMIN', pin: PIN });
  const staff = await makeUser({ username: 'thungan', role: 'STAFF' });
  const c = admin.client;
  const food = (
    await c.menu.createCategory({
      body: { name: 'Món nước', foodCostTarget: null, station: 'KITCHEN', sort: 1 },
    })
  ).body as { id: number };
  const drink = (
    await c.menu.createCategory({ body: { name: 'Đồ uống', foodCostTarget: null, station: 'BAR', sort: 2 } })
  ).body as { id: number };
  const beef = await makeIngredient({ name: 'Thịt bò' });
  const noodle = await makeIngredient({ name: 'Bánh phở' });
  const box = await makeIngredient({ name: 'Hộp', unit: 'cái', kind: 'PACKAGING' });
  const tea = await makeIngredient({ name: 'Trà' });
  const bid = await branchId();
  const lot = (ingredientId: number, qty: number, unitPrice: number, date = '2026-01-01') =>
    prisma.lot.create({
      data: { branchId: bid, ingredientId, date: toDbDate(date), unitPrice, qtyIn: qty, qtyRemaining: qty },
    });
  await lot(beef.id, 1, 100000, '2026-01-01');
  await lot(beef.id, 10, 120000, '2026-01-02');
  await lot(noodle.id, 10, 20000);
  await lot(box.id, 50, 2000);

  const dish = async (
    code: string,
    name: string,
    categoryId: number,
    price: string,
    recipe: { ingredientId: number; qty: string; scope: 'ALL' | 'TAKEAWAY_APP' }[],
  ) => {
    const d = (
      await c.menu.createDish({
        body: { code, name, categoryId, active: true, sort: 1, storePrice: price, appPrice: null },
      })
    ).body as { id: number };
    await c.menu.saveRecipe({
      params: { id: d.id },
      body: { effectiveFrom: '2026-01-01', note: null, items: recipe },
    });
    return d.id;
  };
  const pho = await dish('PHO', 'Phở bò', food.id, '50000', [
    { ingredientId: beef.id, qty: '200', scope: 'ALL' },
    { ingredientId: noodle.id, qty: '300', scope: 'ALL' },
    { ingredientId: box.id, qty: '1', scope: 'TAKEAWAY_APP' },
  ]);
  const traDa = await dish('TRA', 'Trà đá', drink.id, '5000', [
    { ingredientId: tea.id, qty: '10', scope: 'ALL' },
  ]);
  const area = await prisma.area.create({ data: { name: 'Tầng 1' } });
  const t1 = await prisma.diningTable.create({ data: { areaId: area.id, name: 'Bàn 1' } });
  const t2 = await prisma.diningTable.create({ data: { areaId: area.id, name: 'Bàn 2' } });
  return { admin, staff, c, pho, traDa, beef, noodle, box, tea, t1, t2 };
}

type Client = Awaited<ReturnType<typeof makeUser>>['client'];

async function openOrder(
  c: Client,
  items: { dishId: number; qty: number }[],
  over: Partial<{ channel: 'DINE_IN' | 'TAKEAWAY' | 'APP'; tableId: number | null }> = {},
) {
  const res = await c.orders.open({
    body: {
      channel: over.channel ?? 'DINE_IN',
      tableId: over.tableId ?? null,
      deliveryAppId: null,
      appOrderCode: null,
      guestCount: 2,
      note: null,
      items,
    },
  });
  expect(res.status).toBe(201);
  return res.body as OrderDto;
}

const remaining = async (ingredientId: number) =>
  (await prisma.lot.findMany({ where: { ingredientId } })).reduce((s, l) => s + Number(l.qtyRemaining), 0);

const payCash = (c: Client, o: OrderDto, extra: object = {}) =>
  c.orders.pay({
    params: { id: o.id },
    body: {
      version: o.version,
      payments: [{ method: 'CASH', amount: o.total, cashReceived: null }],
      print: false,
      ...extra,
    },
  });

describe('orders', () => {
  it('paying 10 phở takes 2 kg beef + 3 kg noodles by FIFO; open orders take nothing', async () => {
    const { c, pho, beef, noodle, t1 } = await setup();
    const o = await openOrder(c, [{ dishId: pho, qty: 10 }], { tableId: t1.id });
    expect(o.total).toBe('500000');
    expect(await remaining(beef.id)).toBe(11);
    const paid = await payCash(c, o);
    expect(paid.status).toBe(200);
    const order = (paid.body as { order: OrderDto }).order;
    expect(order.status).toBe('PAID');
    expect(await remaining(beef.id)).toBe(9);
    expect(await remaining(noodle.id)).toBe(7);
    // 1 kg × 100.000 + 1 kg × 120.000 + 3 kg × 20.000
    expect(order.costTotal).toBe('280000');
    expect(order.items[0]!.costTotal).toBe('280000');
  });

  it('takeaway also takes packaging, dine-in does not', async () => {
    const { c, pho, box, t1 } = await setup();
    await payCash(c, await openOrder(c, [{ dishId: pho, qty: 2 }], { tableId: t1.id }));
    expect(await remaining(box.id)).toBe(50);
    await payCash(c, await openOrder(c, [{ dishId: pho, qty: 2 }], { channel: 'TAKEAWAY' }));
    expect(await remaining(box.id)).toBe(48);
  });

  it('service charge (dine-in only) then VAT 8% exclusive', async () => {
    const { c, pho, t1 } = await setup();
    await c.settings.update({
      body: {
        settings: {
          tax_regime: 'DEDUCTION', // a company shows VAT on the bill; a household never does
          vat_pct: 8,
          vat_mode: 'EXCLUSIVE',
          service_charge_pct: 5,
          service_charge_channels: ['DINE_IN'],
        },
      },
    });
    const dine = await openOrder(c, [{ dishId: pho, qty: 4 }], { tableId: t1.id });
    expect(dine).toMatchObject({
      netRevenue: '210000',
      serviceChargeAmount: '10000',
      vatAmount: '16800',
      total: '226800',
    });
    const away = await openOrder(c, [{ dishId: pho, qty: 4 }], { channel: 'TAKEAWAY' });
    expect(away).toMatchObject({ serviceChargeAmount: '0', total: '216000' });
  });

  it('order discount 10% lowers each line; split payment must match the total', async () => {
    const { c, pho, traDa, t1 } = await setup();
    let o = await openOrder(
      c,
      [
        { dishId: pho, qty: 2 },
        { dishId: traDa, qty: 2 },
      ],
      { tableId: t1.id },
    );
    o = (
      await c.orders.discount({
        params: { id: o.id },
        body: { version: o.version, type: 'PERCENT', value: '10', reason: 'Khách quen' },
      })
    ).body as OrderDto;
    expect(o.total).toBe('99000');
    expect(o.items.map((i) => i.netAmount)).toEqual(['90000', '9000']);
    const bad = await c.orders.pay({
      params: { id: o.id },
      body: { version: o.version, payments: [{ method: 'CASH', amount: '50000' }], print: false },
    });
    expect(bad.status).toBe(400);
    const ok = await c.orders.pay({
      params: { id: o.id },
      body: {
        version: o.version,
        print: false,
        payments: [
          { method: 'CASH', amount: '49000', cashReceived: '100000' },
          { method: 'TRANSFER', amount: '50000' },
        ],
      },
    });
    expect(ok.status).toBe(200);
    expect((ok.body as { order: OrderDto }).order.payments[0]).toMatchObject({ change: '51000' });
  });

  it('staff discount above the limit needs an admin PIN', async () => {
    const { staff, admin, pho, t1 } = await setup();
    const o = await openOrder(staff.client, [{ dishId: pho, qty: 2 }], { tableId: t1.id });
    const denied = await staff.client.orders.discount({
      params: { id: o.id },
      body: { version: o.version, type: 'PERCENT', value: '30', reason: 'Khai trương' },
    });
    expect(denied.status).toBe(403);
    expect((denied.body as unknown as { error: { code: string } }).error.code).toBe('NEEDS_APPROVAL');
    const wrong = await staff.client.orders.discount({
      params: { id: o.id },
      body: {
        version: o.version,
        type: 'PERCENT',
        value: '30',
        reason: 'Khai trương',
        approval: { approverId: admin.user.id, pin: '9999' },
      },
    });
    expect(wrong.status).toBe(403);
    const ok = await staff.client.orders.discount({
      params: { id: o.id },
      body: {
        version: o.version,
        type: 'PERCENT',
        value: '30',
        reason: 'Khai trương',
        approval: { approverId: admin.user.id, pin: PIN },
      },
    });
    expect(ok.status).toBe(200);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).discountApprovedById).toBe(
      admin.user.id,
    );
  });

  it('a cooked item cancelled after sending becomes a DISPOSAL issue when the order is paid', async () => {
    const { c, pho, traDa, t1 } = await setup();
    let o = await openOrder(
      c,
      [
        { dishId: pho, qty: 2 },
        { dishId: traDa, qty: 1 },
      ],
      { tableId: t1.id },
    );
    o = (
      (await c.orders.sendKitchen({ params: { id: o.id }, body: { version: o.version } })).body as {
        order: OrderDto;
      }
    ).order;
    const phoLine = o.items.find((i) => i.dishId === pho)!;
    const res = await c.orders.cancelItem({
      params: { id: o.id, itemId: phoLine.id },
      body: { version: o.version, qty: 1, reason: 'Khách đổi món', wasted: true },
    });
    expect(res.status).toBe(200);
    o = res.body as OrderDto;
    expect(o.total).toBe('55000');
    await payCash(c, o);
    const disposal = await prisma.issue.findMany({
      where: { orderId: o.id, reason: 'DISPOSAL' },
      include: { items: true },
    });
    expect(disposal).toHaveLength(1);
    expect(disposal[0]!.orderItemId).not.toBeNull();
    expect(disposal[0]!.items.map((i) => Number(i.qty)).sort()).toEqual([0.2, 0.3]);
  });

  it('staff cancels a paid order of today (lots come back); an earlier day needs an admin PIN', async () => {
    const { staff, admin, pho, beef, t1 } = await setup();
    const o = await openOrder(staff.client, [{ dishId: pho, qty: 5 }], { tableId: t1.id });
    await payCash(staff.client, o);
    expect(await remaining(beef.id)).toBe(10);
    const res = await staff.client.orders.cancel({
      params: { id: o.id },
      body: { reason: 'Nhập nhầm đơn', wastedItemIds: [] },
    });
    expect(res.status).toBe(200);
    expect(await remaining(beef.id)).toBe(11);

    const o2 = await openOrder(staff.client, [{ dishId: pho, qty: 1 }], { tableId: t1.id });
    await payCash(staff.client, o2);
    await prisma.order.update({ where: { id: o2.id }, data: { businessDate: toDbDate('2026-01-05') } });
    const denied = await staff.client.orders.cancel({
      params: { id: o2.id },
      body: { reason: 'Khách trả lại', wastedItemIds: [] },
    });
    expect(denied.status).toBe(403);
    const ok = await staff.client.orders.cancel({
      params: { id: o2.id },
      body: { reason: 'Khách trả lại', wastedItemIds: [], approval: { approverId: admin.user.id, pin: PIN } },
    });
    expect(ok.status).toBe(200);
    expect(
      await prisma.auditLog.count({
        where: { entity: 'order', action: 'CANCEL', approvedById: admin.user.id },
      }),
    ).toBe(1);
  });

  it('merging moves items and frees the source table', async () => {
    const { c, pho, traDa, t1, t2 } = await setup();
    const a = await openOrder(c, [{ dishId: pho, qty: 1 }], { tableId: t1.id });
    const b = await openOrder(c, [{ dishId: traDa, qty: 2 }], { tableId: t2.id });
    const res = await c.orders.merge({
      params: { id: a.id },
      body: { version: a.version, targetOrderId: b.id },
    });
    expect(res.status).toBe(200);
    expect((res.body as OrderDto).total).toBe('60000');
    const floor = (await c.orders.floor()).body as {
      areas: { tables: { id: number; orders: unknown[] }[] }[];
    };
    const tables = floor.areas[0]!.tables;
    expect(tables.find((t) => t.id === t1.id)!.orders).toHaveLength(0);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: a.id } })).cancelKind).toBe('MERGED');
  });

  it('a stale version is rejected with 409', async () => {
    const { c, pho, t1 } = await setup();
    const o = await openOrder(c, [{ dishId: pho, qty: 1 }], { tableId: t1.id });
    await c.orders.addItems({
      params: { id: o.id },
      body: { version: o.version, items: [{ dishId: pho, qty: 1 }] },
    });
    const stale = await c.orders.addItems({
      params: { id: o.id },
      body: { version: o.version, items: [{ dishId: pho, qty: 1 }] },
    });
    expect(stale.status).toBe(409);
  });

  it('split 2 trà + 1 phở off 4 trà + 2 phở; percentage discount follows', async () => {
    const { c, pho, traDa, t1 } = await setup();
    let o = await openOrder(
      c,
      [
        { dishId: traDa, qty: 4 },
        { dishId: pho, qty: 2 },
      ],
      { tableId: t1.id },
    );
    o = (
      await c.orders.discount({
        params: { id: o.id },
        body: { version: o.version, type: 'PERCENT', value: '10', reason: 'Khách quen' },
      })
    ).body as OrderDto;
    const [tra, ph] = [o.items.find((i) => i.dishId === traDa)!, o.items.find((i) => i.dishId === pho)!];
    const res = await c.orders.split({
      params: { id: o.id },
      body: {
        version: o.version,
        tableId: null,
        lines: [
          { itemId: tra.id, qty: 2 },
          { itemId: ph.id, qty: 1 },
        ],
      },
    });
    expect(res.status).toBe(200);
    const { source, created } = res.body as { source: OrderDto; created: OrderDto };
    expect(source.total).toBe('54000');
    expect(created.total).toBe('54000');
    expect(created.tableId).toBe(t1.id);
    expect(created.splitFromOrderId).toBe(o.id);
  });

  it('kitchen and bar each get their own items; a bar account cannot read the kitchen queue', async () => {
    const { c, pho, traDa, t1 } = await setup();
    const o = await openOrder(
      c,
      [
        { dishId: pho, qty: 1 },
        { dishId: traDa, qty: 1 },
      ],
      { tableId: t1.id },
    );
    await c.orders.sendKitchen({ params: { id: o.id }, body: { version: o.version } });
    const bar = await makeUser({ username: 'bar1', role: 'KITCHEN', station: 'BAR' });
    const q = await bar.client.kitchen.queue({ query: { station: 'BAR' } });
    expect((q.body as { dishName: string }[]).map((i) => i.dishName)).toEqual(['Trà đá']);
    expect((await bar.client.kitchen.queue({ query: { station: 'KITCHEN' } })).status).toBe(403);
    const itemId = (q.body as { itemId: number }[])[0]!.itemId;
    const done = await bar.client.kitchen.setStatus({ params: { itemId }, body: { status: 'DONE' } });
    expect((done.body as { kitchenStatus: string }).kitchenStatus).toBe('DONE');
  });

  it('a sold-out dish cannot be added', async () => {
    const { c, pho, t1 } = await setup();
    await c.menu.setAvailability({ params: { id: pho }, body: { soldOut: true } });
    const res = await c.orders.open({
      body: {
        channel: 'DINE_IN',
        tableId: t1.id,
        deliveryAppId: null,
        appOrderCode: null,
        guestCount: 1,
        note: null,
        items: [{ dishId: pho, qty: 1 }],
      },
    });
    expect(res.status).toBe(409);
  });

  it('selling without stock creates "nợ kho"; a later receipt settles it and fixes the order cost', async () => {
    const { c, traDa, tea, t1 } = await setup();
    const o = await openOrder(c, [{ dishId: traDa, qty: 10 }], { tableId: t1.id });
    await payCash(c, o);
    const pending = await prisma.issueItem.findFirstOrThrow({ where: { ingredientId: tea.id } });
    expect(Number(pending.pendingQty)).toBe(0.1);
    const today = await businessToday();
    await c.inventory.createReceipt({
      body: {
        kind: 'PURCHASE',
        date: today,
        supplier: null,
        note: null,
        items: [{ ingredientId: tea.id, qty: '1', unitPrice: '150000', unitMode: 'STOCK' }],
      },
    });
    const order = (await c.orders.get({ params: { id: o.id } })).body as OrderDto;
    expect(order.costTotal).toBe('15000');
  });

  it('day closing refuses open orders and expects the cash taken', async () => {
    const { staff, pho, t1, t2 } = await setup();
    const today = await businessToday();
    const a = await openOrder(staff.client, [{ dishId: pho, qty: 2 }], { tableId: t1.id });
    await payCash(staff.client, a);
    const b = await openOrder(staff.client, [{ dishId: pho, qty: 1 }], { tableId: t2.id });
    expect(
      (
        await staff.client.dayClosing.close({
          params: { date: today },
          body: { countedCash: '100000', note: null },
        })
      ).status,
    ).toBe(409);
    await staff.client.orders.pay({
      params: { id: b.id },
      body: { version: b.version, payments: [{ method: 'TRANSFER', amount: '50000' }], print: false },
    });
    const res = await staff.client.dayClosing.close({
      params: { date: today },
      body: { countedCash: '98000', note: 'Thiếu tiền lẻ' },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      expectedCash: '100000',
      diff: '-2000',
      expectedByMethod: { CASH: '100000', TRANSFER: '50000' },
    });
  });

  it('staff never receive cost fields', async () => {
    const { staff, pho, t1 } = await setup();
    const o = await openOrder(staff.client, [{ dishId: pho, qty: 1 }], { tableId: t1.id });
    expect(o).not.toHaveProperty('costTotal');
    expect(o.items[0]).not.toHaveProperty('costTotal');
  });

  it('selling below cost needs a reason', async () => {
    const { c, pho, t1 } = await setup();
    let o = await openOrder(c, [{ dishId: pho, qty: 1 }], { tableId: t1.id });
    o = (
      await c.orders.discount({
        params: { id: o.id },
        body: { version: o.version, type: 'PERCENT', value: '90', reason: 'Mời khách' },
      })
    ).body as OrderDto;
    const res = await payCash(c, o);
    expect(res.status).toBe(409);
    expect((res.body as unknown as { error: { code: string } }).error.code).toBe('BELOW_COST');
    expect(
      await remaining((await prisma.ingredient.findFirstOrThrow({ where: { name: 'Thịt bò' } })).id),
    ).toBe(11);
    expect((await payCash(c, o, { belowCostReason: 'Mời khách VIP' })).status).toBe(200);
  });

  it('order codes are unique per business day', async () => {
    const { c, pho } = await setup();
    const orders = await Promise.all(
      [1, 2, 3, 4].map(() => openOrder(c, [{ dishId: pho, qty: 1 }], { channel: 'TAKEAWAY' })),
    );
    expect(new Set(orders.map((o) => o.code)).size).toBe(4);
  });
});
