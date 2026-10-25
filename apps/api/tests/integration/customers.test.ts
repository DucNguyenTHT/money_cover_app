import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/core/db';
import { toDbDate } from '../../src/domain/business-date';
import type { OrderDto } from '../../src/contracts/orders.contract';
import type { CustomerDto } from '../../src/contracts/customers.contract';
import { makeUser, resetDb, startServer, stopServer } from '../helpers/harness';
import { branchId, makeIngredient } from '../helpers/factories';

beforeAll(startServer);
afterAll(stopServer);
beforeEach(resetDb);

type Client = Awaited<ReturnType<typeof makeUser>>['client'];

async function setup(loyalty = true) {
  const admin = await makeUser({ username: 'chu', role: 'ADMIN' });
  const staff = await makeUser({ username: 'lan', role: 'STAFF' });
  const c = admin.client;
  await c.settings.update({ body: { settings: { loyalty_enabled: loyalty } } });
  const cat = (
    await c.menu.createCategory({ body: { name: 'Món', foodCostTarget: null, station: 'KITCHEN', sort: 1 } })
  ).body as { id: number };
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
  const dish = async (code: string, price: string) => {
    const d = (
      await c.menu.createDish({
        body: {
          code,
          name: `Món ${code}`,
          categoryId: cat.id,
          active: true,
          sort: 1,
          storePrice: price,
          appPrice: null,
        },
      })
    ).body as { id: number };
    await c.menu.saveRecipe({
      params: { id: d.id },
      body: {
        effectiveFrom: '2026-01-01',
        note: null,
        items: [{ ingredientId: ing.id, qty: '50', scope: 'ALL' }],
      },
    });
    return d.id;
  };
  return { admin, staff, a: await dish('A', '25000'), b: await dish('B', '50000') };
}

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
const pay = async (c: Client, o: OrderDto) =>
  c.orders.pay({
    params: { id: o.id },
    body: { version: o.version, payments: [{ method: 'CASH', amount: o.total }], print: false },
  });
const customerOf = async (c: Client, id: number) =>
  ((await c.customers.get({ params: { id } })).body as { customer: CustomerDto }).customer;

describe('regular customers (khách quen)', () => {
  it('one customer per phone; found by part of the phone or the name without accents', async () => {
    const { staff } = await setup();
    const r = await staff.client.customers.create({
      body: { phone: '+84 90-123 4567', name: 'Nguyễn Văn Nam' },
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ phone: '0901234567', points: 0, visits: 0 });
    const dup = await staff.client.customers.create({ body: { phone: '0901234567', name: 'Khác' } });
    expect(dup.status).toBe(409);
    expect(JSON.stringify(dup.body)).toContain('Nguyễn Văn Nam');
    expect((await staff.client.customers.create({ body: { phone: '12345', name: 'X' } })).status).toBe(400);
    const byPhone = (await staff.client.customers.list({ query: { q: '4567' } })).body as CustomerDto[];
    expect(byPhone.map((x) => x.name)).toEqual(['Nguyễn Văn Nam']);
    const byName = (await staff.client.customers.list({ query: { q: 'nguyen van' } })).body as CustomerDto[];
    expect(byName.map((x) => x.name)).toEqual(['Nguyễn Văn Nam']);
  });

  it('earns on paying, spends as money off, gives everything back when the order is cancelled', async () => {
    const { admin, staff, a, b } = await setup();
    const cust = (await staff.client.customers.create({ body: { phone: '0901234567', name: 'Nam' } }))
      .body as CustomerDto;

    // 5 × 25.000 = 125.000 → 12 points.
    let o = await open(staff.client, [{ dishId: a, qty: 5 }]);
    o = (
      await staff.client.orders.update({
        params: { id: o.id },
        body: { version: o.version, customerId: cust.id },
      })
    ).body as OrderDto;
    expect(o.customer).toMatchObject({ id: cust.id, name: 'Nam', points: 0 });
    const paid = ((await pay(staff.client, o)).body as { order: OrderDto }).order;
    expect(paid.pointsEarned).toBe(12);
    expect(await customerOf(staff.client, cust.id)).toMatchObject({
      points: 12,
      visits: 1,
      totalSpent: '125000',
    });

    // Staff cannot add points by hand; ADMIN can, with a reason.
    expect(
      (
        await staff.client.customers.adjustPoints({
          params: { id: cust.id },
          body: { points: 50, reason: 'Tặng khai trương' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await admin.client.customers.adjustPoints({
          params: { id: cust.id },
          body: { points: 50, reason: 'Tặng khai trương' },
        })
      ).body,
    ).toMatchObject({ points: 62 });

    // 2 × 50.000 = 100.000: at most 50% = 100 points; at least 20; 30 points = 15.000 off.
    let o2 = await open(staff.client, [{ dishId: b, qty: 2 }]);
    o2 = (
      await staff.client.orders.update({
        params: { id: o2.id },
        body: { version: o2.version, customerId: cust.id },
      })
    ).body as OrderDto;
    expect(
      (
        await staff.client.orders.redeemPoints({
          params: { id: o2.id },
          body: { version: o2.version, points: 10 },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await staff.client.orders.redeemPoints({
          params: { id: o2.id },
          body: { version: o2.version, points: 63 },
        })
      ).status,
    ).toBe(400);
    const r = await staff.client.orders.redeemPoints({
      params: { id: o2.id },
      body: { version: o2.version, points: 30 },
    });
    o2 = r.body as OrderDto;
    expect(o2).toMatchObject({ pointsRedeemed: 30, pointsDiscount: '15000', total: '85000' });
    // Not taken before paying.
    expect((await customerOf(staff.client, cust.id)).points).toBe(62);
    const paid2 = ((await pay(staff.client, o2)).body as { order: OrderDto }).order;
    expect(paid2.pointsEarned).toBe(8); // 85.000
    expect(await customerOf(staff.client, cust.id)).toMatchObject({ points: 40, visits: 2 });

    // The day report counts the points as a discount.
    const day = (
      await admin.client.reports.daily({ query: { from: paid2.businessDate, to: paid2.businessDate } })
    ).body as { discounts: string }[];
    expect(day[0]!.discounts).toBe('15000');

    await staff.client.orders.cancel({
      params: { id: paid2.id },
      body: { reason: 'Khách đổi ý', wastedItemIds: [] },
    });
    const after = await staff.client.customers.get({ params: { id: cust.id } });
    const body = after.body as { customer: CustomerDto; entries: { kind: string; points: number }[] };
    expect(body.customer).toMatchObject({ points: 62, visits: 1, totalSpent: '125000' });
    expect(body.entries.map((e) => [e.kind, e.points])).toEqual([
      ['REVERSE', 22],
      ['EARN', 8],
      ['REDEEM', -30],
      ['ADJUST', 50],
      ['EARN', 12],
    ]);
  });

  it('removing dishes drops points that no longer fit; another customer starts again; off = nothing earned', async () => {
    const { admin, staff, a, b } = await setup();
    const c1 = (await staff.client.customers.create({ body: { phone: '0901234567', name: 'Nam' } }))
      .body as CustomerDto;
    const c2 = (await staff.client.customers.create({ body: { phone: '0907654321', name: 'Lan' } }))
      .body as CustomerDto;
    await admin.client.customers.adjustPoints({
      params: { id: c1.id },
      body: { points: 200, reason: 'Chuyển từ thẻ cũ' },
    });
    let o = await open(staff.client, [
      { dishId: b, qty: 1 },
      { dishId: a, qty: 4 },
    ]); // 150.000
    o = (
      await staff.client.orders.update({
        params: { id: o.id },
        body: { version: o.version, customerId: c1.id },
      })
    ).body as OrderDto;
    o = (
      await staff.client.orders.redeemPoints({
        params: { id: o.id },
        body: { version: o.version, points: 150 },
      })
    ).body as OrderDto;
    expect(o.pointsDiscount).toBe('75000'); // 50% of 150.000
    const big = o.items.find((i) => i.dishId === a)!;
    o = (
      await staff.client.orders.removeItem({
        params: { id: o.id, itemId: big.id },
        body: { version: o.version },
      })
    ).body as OrderDto;
    // 75.000 off no longer fits a 50.000 order: dropped, to be spent again.
    expect(o).toMatchObject({ pointsRedeemed: 0, pointsDiscount: '0', total: '50000' });
    const small = await open(staff.client, [{ dishId: a, qty: 1 }]);
    let s2 = (
      await staff.client.orders.update({
        params: { id: small.id },
        body: { version: small.version, customerId: c1.id },
      })
    ).body as OrderDto;
    s2 = (
      await staff.client.orders.redeemPoints({
        params: { id: s2.id },
        body: { version: s2.version, points: 25 },
      })
    ).body as OrderDto;
    expect(s2.pointsDiscount).toBe('12500');
    s2 = (
      await staff.client.orders.update({
        params: { id: s2.id },
        body: { version: s2.version, customerId: c2.id },
      })
    ).body as OrderDto;
    expect(s2).toMatchObject({ customer: { name: 'Lan' }, pointsRedeemed: 0, total: '25000' });

    await admin.client.settings.update({ body: { settings: { loyalty_enabled: false } } });
    const paid = ((await pay(staff.client, s2)).body as { order: OrderDto }).order;
    expect(paid.pointsEarned).toBe(0);
    expect(await customerOf(staff.client, c2.id)).toMatchObject({ points: 0, visits: 1 });
    expect(
      (
        await staff.client.orders.redeemPoints({
          params: { id: o.id },
          body: { version: o.version, points: 20 },
        })
      ).status,
    ).toBe(400);
  });
});
