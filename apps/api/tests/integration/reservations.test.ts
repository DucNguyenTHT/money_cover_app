import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/core/db';
import { toDbDate } from '../../src/domain/business-date';
import type { OrderDto, DayPreview } from '../../src/contracts/orders.contract';
import type { ReservationDto } from '../../src/contracts/reservations.contract';
import { morningLines } from '../../src/modules/reservations/reservations.service';
import { businessToday } from '../../src/modules/settings/settings.service';
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
  const cat = (
    await c.menu.createCategory({ body: { name: 'Món', foodCostTarget: null, station: 'KITCHEN', sort: 1 } })
  ).body as {
    id: number;
  };
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
  const dish = (
    await c.menu.createDish({
      body: {
        code: 'LAU',
        name: 'Lẩu',
        categoryId: cat.id,
        active: true,
        sort: 1,
        storePrice: '500000',
        appPrice: null,
      },
    })
  ).body as { id: number };
  await c.menu.saveRecipe({
    params: { id: dish.id },
    body: {
      effectiveFrom: '2026-01-01',
      note: null,
      items: [{ ingredientId: ing.id, qty: '100', scope: 'ALL' }],
    },
  });
  const area = await prisma.area.create({ data: { name: 'Tầng 1' } });
  const t1 = await prisma.diningTable.create({ data: { areaId: area.id, name: 'Bàn 1' } });
  const t2 = await prisma.diningTable.create({ data: { areaId: area.id, name: 'Bàn 2' } });
  return { admin, staff, dish: dish.id, t1: t1.id, t2: t2.id };
}

const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const booking = (over: Record<string, unknown> = {}) => ({
  name: 'Anh Nam',
  phone: null,
  guests: 6,
  reservedAt: inHours(2),
  durationMin: 120,
  tableId: null,
  note: null,
  deposit: '0',
  depositMethod: null,
  ...over,
});
const book = async (c: Client, over: Record<string, unknown> = {}) =>
  c.reservations.create({ body: booking(over) as never });
const preview = async (c: Client, date: string) =>
  (await c.dayClosing.preview({ params: { date } })).body as DayPreview;

describe('reservations (đặt bàn)', () => {
  it('a table cannot be booked twice for the same time; the phone finds the regular customer', async () => {
    const { staff, t1, t2 } = await setup();
    const cust = (await staff.client.customers.create({ body: { phone: '0901234567', name: 'Nam' } }))
      .body as { id: number };
    const r = await book(staff.client, { tableId: t1, phone: '+84 901 234 567' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      phone: '0901234567',
      customerId: cust.id,
      customerName: 'Nam',
      tableName: 'Bàn 1',
      status: 'BOOKED',
    });
    const clash = await book(staff.client, { tableId: t1, name: 'Chị Lan', reservedAt: inHours(3) });
    expect(clash.status).toBe(409);
    expect(JSON.stringify(clash.body)).toContain('Anh Nam');
    expect((await book(staff.client, { tableId: t2, reservedAt: inHours(3) })).status).toBe(201);
    expect((await book(staff.client, { tableId: t1, reservedAt: inHours(4) })).status).toBe(201); // after the first
    expect((await book(staff.client, { reservedAt: inHours(-3) })).status).toBe(400);
    expect((await book(staff.client, { deposit: '200000' })).status).toBe(400); // how was it paid?

    const today = (r.body as ReservationDto).businessDate;
    const list = (await staff.client.reservations.list({ query: { from: today, to: today } }))
      .body as ReservationDto[];
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  it('cash deposit: into the till the day it is taken, out again when the bill is paid in full', async () => {
    const { staff, dish, t1 } = await setup();
    const r = (await book(staff.client, { tableId: t1, deposit: '200000', depositMethod: 'CASH' }))
      .body as ReservationDto;
    // Cash is counted on the business day it moves (today), whatever day the booking is for.
    const day = await businessToday();
    expect(await preview(staff.client, day)).toMatchObject({ cashIn: '200000', expectedCash: '200000' });

    // Changing the deposit replaces the cash entry.
    const upd = await staff.client.reservations.update({
      params: { id: r.id },
      body: booking({
        tableId: t1,
        reservedAt: r.reservedAt,
        deposit: '300000',
        depositMethod: 'CASH',
      }) as never,
    });
    expect(upd.status).toBe(200);
    expect((await preview(staff.client, day)).cashIn).toBe('300000');

    // Guests arrive: the order is opened from the booking.
    const o = (
      await staff.client.orders.open({
        body: {
          channel: 'DINE_IN',
          tableId: t1,
          deliveryAppId: null,
          appOrderCode: null,
          guestCount: 6,
          note: null,
          items: [{ dishId: dish, qty: 2 }],
          reservationId: r.id,
        },
      })
    ).body as OrderDto;
    expect(o.reservation).toMatchObject({
      id: r.id,
      deposit: '300000',
      depositMethod: 'CASH',
      depositOutcome: null,
    });
    const again = await staff.client.orders.open({
      body: {
        channel: 'DINE_IN',
        tableId: t1,
        deliveryAppId: null,
        appOrderCode: null,
        guestCount: 6,
        note: null,
        items: [],
        reservationId: r.id,
      },
    });
    expect(again.status).toBe(400);
    const list = (
      await staff.client.reservations.list({ query: { from: r.businessDate, to: r.businessDate } })
    ).body as ReservationDto[];
    expect(list.find((x) => x.id === r.id)).toMatchObject({
      status: 'ARRIVED',
      orderId: o.id,
      orderCode: o.code,
    });

    // The cash deposit has to be inside the cash line.
    const byCard = await staff.client.orders.pay({
      params: { id: o.id },
      body: { version: o.version, payments: [{ method: 'CARD', amount: '1000000' }], print: false },
    });
    expect(byCard.status).toBe(400);
    expect(JSON.stringify(byCard.body)).toContain('dòng Tiền mặt');

    // 1.000.000 bill taken in full as cash; the guests hand over 700.000 — the till ends with 300.000 + 700.000.
    const paid = await staff.client.orders.pay({
      params: { id: o.id },
      body: { version: o.version, payments: [{ method: 'CASH', amount: '1000000' }], print: false },
    });
    expect(paid.status).toBe(200);
    expect(await preview(staff.client, day)).toMatchObject({
      cashSales: '1000000',
      cashIn: '300000',
      cashOut: '300000',
      expectedCash: '1000000',
    });

    // The paid order cancelled: the deposit is held again, then given back from the booking.
    await staff.client.orders.cancel({
      params: { id: o.id },
      body: { reason: 'Khách phàn nàn', wastedItemIds: [] },
    });
    expect((await preview(staff.client, day)).cashOut).toBe('0');
    const refund = await staff.client.reservations.cancel({
      params: { id: r.id },
      body: { status: 'CANCELLED', reason: 'Hoàn cọc cho khách', refund: true },
    });
    expect(refund.body).toMatchObject({ status: 'CANCELLED', depositOutcome: 'REFUNDED' });
    expect(await preview(staff.client, day)).toMatchObject({
      cashIn: '300000',
      cashOut: '300000',
      expectedCash: '0',
    });
    // Its cash entries are managed from the booking, not the cash book.
    const entries = (await staff.client.cash.list({ query: { from: day, to: day } })).body as {
      entries: { id: number; source: string | null }[];
    };
    const auto = entries.entries.find((e) => e.source === 'RESERVATION')!;
    expect(
      (await staff.client.cash.cancel({ params: { id: auto.id }, body: { reason: 'Thử huỷ tay' } })).status,
    ).toBe(403);
  });

  it('transfer deposit stays out of the till; no-show keeps it; the morning message lists today', async () => {
    const { staff, t2 } = await setup();
    const r = (
      await book(staff.client, {
        tableId: t2,
        deposit: '500000',
        depositMethod: 'TRANSFER',
        name: 'Chị Lan',
        guests: 10,
      })
    ).body as ReservationDto;
    const today = await businessToday();
    expect((await preview(staff.client, today)).cashIn).toBe('0');
    const lines = await morningLines();
    if (r.businessDate === today) expect(lines.join()).toContain('Chị Lan (10, Bàn 2)');
    const kept = await staff.client.reservations.cancel({
      params: { id: r.id },
      body: { status: 'NO_SHOW', reason: 'Khách không đến, không báo', refund: false },
    });
    expect(kept.body).toMatchObject({ status: 'NO_SHOW', depositOutcome: 'KEPT' });
    expect(
      (
        await staff.client.reservations.cancel({
          params: { id: r.id },
          body: { status: 'CANCELLED', reason: 'Bấm lại lần nữa', refund: true },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await staff.client.reservations.update({
          params: { id: r.id },
          body: booking({ reservedAt: r.reservedAt }) as never,
        })
      ).status,
    ).toBe(400);
  });
});
