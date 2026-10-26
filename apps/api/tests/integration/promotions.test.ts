import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/core/db';
import { toDbDate } from '../../src/domain/business-date';
import { weekdayOf } from '../../src/domain/promotions/promotions';
import type { OrderDto } from '../../src/contracts/orders.contract';
import type { PromotionDto } from '../../src/contracts/promotions.contract';
import { makeUser, resetDb, startServer, stopServer } from '../helpers/harness';
import { branchId, makeIngredient } from '../helpers/factories';

beforeAll(startServer);
afterAll(stopServer);
beforeEach(resetDb);

type Client = Awaited<ReturnType<typeof makeUser>>['client'];

async function setup() {
  const admin = await makeUser({ username: 'chu', role: 'ADMIN' });
  const staff = await makeUser({ username: 'lan', role: 'STAFF' });
  const c = admin.client;
  const category = async (name: string) =>
    (
      (await c.menu.createCategory({ body: { name, foodCostTarget: null, station: 'KITCHEN', sort: 1 } }))
        .body as { id: number }
    ).id;
  const food = await category('Món');
  const drinks = await category('Đồ uống');
  const ing = await makeIngredient({ name: 'Bò' });
  await prisma.lot.create({
    data: {
      branchId: await branchId(),
      ingredientId: ing.id,
      date: toDbDate('2026-01-01'),
      unitPrice: 100000,
      qtyIn: 50,
      qtyRemaining: 50,
    },
  });
  const dish = async (code: string, categoryId: number, price: string) => {
    const d = (
      await c.menu.createDish({
        body: { code, name: code, categoryId, active: true, sort: 1, storePrice: price, appPrice: null },
      })
    ).body as { id: number };
    await c.menu.saveRecipe({
      params: { id: d.id },
      body: {
        effectiveFrom: '2026-01-01',
        note: null,
        items: [{ ingredientId: ing.id, qty: '10', scope: 'ALL' }],
      },
    });
    return d.id;
  };
  return {
    admin,
    staff,
    drinks,
    pho: await dish('Phở', food, '50000'),
    tra: await dish('Trà đá', drinks, '5000'),
    sua: await dish('Trà sữa', drinks, '30000'),
  };
}

const promo = (over: Record<string, unknown>) => ({
  name: 'KM',
  kind: 'TIME' as const,
  active: true,
  startDate: null,
  endDate: null,
  weekdays: [],
  startTime: null,
  endTime: null,
  channels: ['DINE_IN' as const, 'TAKEAWAY' as const],
  percent: null,
  comboPrice: null,
  items: [],
  ...over,
});

async function open(c: Client, items: { dishId: number; qty: number }[]) {
  return (
    await c.orders.open({
      body: {
        channel: 'TAKEAWAY',
        tableId: null,
        deliveryAppId: null,
        appOrderCode: null,
        guestCount: 1,
        note: null,
        items,
      },
    })
  ).body as OrderDto;
}
const get = async (c: Client, id: number) => (await c.orders.get({ params: { id } })).body as OrderDto;
const line = (o: OrderDto, dishId: number) =>
  o.items.find((i) => i.dishId === dishId && i.status === 'ACTIVE')!;

describe('promotions (giờ vàng, combo)', () => {
  it('happy hour takes % off the covered dishes; combos price a full set; hand discounts are left alone', async () => {
    const { admin, staff, drinks, pho, tra, sua } = await setup();
    expect((await staff.client.promotions.list()).status).toBe(403);
    const happy = await admin.client.promotions.create({
      body: promo({
        name: 'Giờ vàng đồ uống',
        percent: '20',
        items: [{ dishId: null, categoryId: drinks, qty: 1 }],
      }),
    });
    expect(happy.status).toBe(201);
    const combo = (
      await admin.client.promotions.create({
        body: promo({
          name: 'Phở + trà',
          kind: 'COMBO',
          comboPrice: '49000',
          items: [
            { dishId: pho, categoryId: null, qty: 1 },
            { dishId: tra, categoryId: null, qty: 1 },
          ],
        }),
      })
    ).body as PromotionDto;
    expect(combo).toMatchObject({ status: 'RUNNING', items: [{ name: 'Phở' }, { name: 'Trà đá' }] });

    // 2 trà sữa (−20%), 1 phở + 1 trà đá (combo 49.000 instead of 55.000).
    let o = await open(staff.client, [
      { dishId: sua, qty: 2 },
      { dishId: pho, qty: 1 },
      { dishId: tra, qty: 1 },
    ]);
    expect(line(o, sua)).toMatchObject({ promoDiscount: '12000', promotionName: 'Giờ vàng đồ uống' });
    expect(line(o, pho)).toMatchObject({ promoDiscount: '5455', promotionName: 'Phở + trà' });
    expect(line(o, tra)).toMatchObject({ promoDiscount: '545' });
    expect(o).toMatchObject({
      subtotal: '115000',
      promoDiscountTotal: '18000',
      itemDiscountTotal: '0',
      total: '97000',
    });

    // Removing the trà đá breaks the set.
    o = (
      await staff.client.orders.removeItem({
        params: { id: o.id, itemId: line(o, tra).id },
        body: { version: o.version },
      })
    ).body as OrderDto;
    expect(line(o, pho).promoDiscount).toBe('0');
    expect(o.promoDiscountTotal).toBe('12000');

    // A line discounted by hand gets no promotion (no double discount).
    const r = await admin.client.orders.updateItem({
      params: { id: o.id, itemId: line(o, sua).id },
      body: { version: o.version, discountAmount: '5000', discountReason: 'Khách quen' },
    });
    o = r.body as OrderDto;
    expect(line(o, sua)).toMatchObject({ discountAmount: '5000', promoDiscount: '0', promotionName: null });
    expect(o).toMatchObject({ promoDiscountTotal: '0', itemDiscountTotal: '5000', total: '105000' });
  });

  it('only for lines ordered inside the hours, on its days; saving a promotion updates open orders', async () => {
    const { admin, staff, sua } = await setup();
    let o = await open(staff.client, [{ dishId: sua, qty: 1 }]);
    expect(o.promoDiscountTotal).toBe('0');
    // Ordered at 15:00 shop time.
    await prisma.orderItem.updateMany({
      where: { orderId: o.id },
      data: { createdAt: new Date(`${o.businessDate}T08:00:00.000Z`) },
    });
    const p = (
      await admin.client.promotions.create({
        body: promo({
          name: 'Chiều',
          percent: '10',
          startTime: '14:00',
          endTime: '17:00',
          items: [{ dishId: sua, categoryId: null, qty: 1 }],
        }),
      })
    ).body as PromotionDto;
    o = await get(staff.client, o.id);
    expect(o).toMatchObject({ promoDiscountTotal: '3000', total: '27000' });

    const body = {
      ...promo({}),
      ...p,
      items: p.items.map(({ dishId, categoryId, qty }) => ({ dishId, categoryId, qty })),
    };
    const save = (over: Record<string, unknown>) =>
      admin.client.promotions.update({ params: { id: p.id }, body: { ...body, ...over } as never });
    await save({ startTime: '16:00', endTime: '18:00' });
    expect((await get(staff.client, o.id)).promoDiscountTotal).toBe('0');
    const today = weekdayOf(o.businessDate);
    await save({ weekdays: [1, 2, 3, 4, 5, 6, 7].filter((d) => d !== today) });
    expect((await get(staff.client, o.id)).promoDiscountTotal).toBe('0');
    await save({ weekdays: [today], channels: ['DINE_IN'] });
    expect((await get(staff.client, o.id)).promoDiscountTotal).toBe('0'); // takeaway not included
    await save({ weekdays: [today] });
    expect((await get(staff.client, o.id)).promoDiscountTotal).toBe('3000');

    expect(
      (
        await admin.client.promotions.update({
          params: { id: p.id },
          body: { ...body, startTime: '14:00', endTime: null } as never,
        })
      ).status,
    ).toBe(400);
  });

  it('paid: counted as a discount in reports and in the month total; a used promotion is switched off, not deleted', async () => {
    const { admin, staff, sua } = await setup();
    const p = (await admin.client.promotions.create({ body: promo({ name: 'Cả menu', percent: '10' }) }))
      .body as PromotionDto;
    const o = await open(staff.client, [{ dishId: sua, qty: 2 }]);
    const paid = await staff.client.orders.pay({
      params: { id: o.id },
      body: { version: o.version, payments: [{ method: 'CASH', amount: o.total }], print: false },
    });
    expect(paid.status).toBe(200);
    const day = (await admin.client.reports.daily({ query: { from: o.businessDate, to: o.businessDate } }))
      .body as { discounts: string }[];
    expect(day[0]!.discounts).toBe('6000');
    const list = (await admin.client.promotions.list()).body as PromotionDto[];
    expect(list.find((x) => x.id === p.id)).toMatchObject({ monthOrders: 1, monthAmount: '6000' });

    expect((await admin.client.promotions.remove({ params: { id: p.id }, body: {} })).status).toBe(400);
    const open2 = await open(staff.client, [{ dishId: sua, qty: 1 }]);
    expect(open2.promoDiscountTotal).toBe('3000');
    const items = p.items.map(({ dishId, categoryId, qty }) => ({ dishId, categoryId, qty }));
    await admin.client.promotions.update({
      params: { id: p.id },
      body: { ...promo({}), ...p, items, active: false } as never,
    });
    expect((await get(staff.client, open2.id)).promoDiscountTotal).toBe('0');
    // The paid order keeps its promotion.
    expect((await get(staff.client, o.id)).promoDiscountTotal).toBe('6000');

    // Used only by an open order: can be deleted, the open order is worked out again.
    const unused = (await admin.client.promotions.create({ body: promo({ name: 'Thử', percent: '5' }) }))
      .body as PromotionDto;
    expect((await get(staff.client, open2.id)).promoDiscountTotal).toBe('1500');
    expect((await admin.client.promotions.remove({ params: { id: unused.id }, body: {} })).status).toBe(200);
    expect((await get(staff.client, open2.id)).promoDiscountTotal).toBe('0');
  });
});
