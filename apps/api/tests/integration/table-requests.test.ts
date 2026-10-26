import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/core/db';
import { toDbDate } from '../../src/domain/business-date';
import type { OrderDto } from '../../src/contracts/orders.contract';
import type { GuestMenu, GuestRequest, TableRequestDto } from '../../src/contracts/table-requests.contract';
import { clientFor, makeUser, resetDb, startServer, stopServer } from '../helpers/harness';
import { branchId, makeIngredient } from '../helpers/factories';

beforeAll(startServer);
afterAll(stopServer);
beforeEach(resetDb);

async function setup() {
  const admin = await makeUser({ username: 'chu', role: 'ADMIN' });
  const staff = await makeUser({ username: 'lan', role: 'STAFF' });
  const c = admin.client;
  const cat = (
    await c.menu.createCategory({ body: { name: 'Đồ uống', foodCostTarget: null, station: 'BAR', sort: 1 } })
  ).body as {
    id: number;
  };
  const ing = await makeIngredient({ name: 'Trà' });
  await prisma.lot.create({
    data: {
      branchId: await branchId(),
      ingredientId: ing.id,
      date: toDbDate('2026-01-01'),
      unitPrice: 100,
      qtyIn: 5000,
      qtyRemaining: 5000,
    },
  });
  const dish = async (code: string, price: string | null) => {
    const d = (
      await c.menu.createDish({
        body: {
          code,
          name: code,
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
        items: [{ ingredientId: ing.id, qty: '10', scope: 'ALL' }],
      },
    });
    return d.id;
  };
  const sua = await dish('Trà sữa', '30000');
  const tra = await dish('Trà đá', '5000');
  await dish('Món chưa giá', null);
  const size = (
    await c.menu.createOptionGroup({
      body: {
        name: 'Size',
        multi: false,
        required: true,
        maxSelect: null,
        sort: 1,
        active: true,
        options: [
          {
            id: null,
            name: 'Vừa',
            price: '0',
            recipeFactor: '1',
            isDefault: true,
            active: true,
            sort: 1,
            ingredients: [],
          },
          {
            id: null,
            name: 'Lớn',
            price: '10000',
            recipeFactor: '1.5',
            isDefault: false,
            active: true,
            sort: 2,
            ingredients: [],
          },
        ],
      } as never,
    })
  ).body as { id: number; options: { id: number; name: string }[] };
  await c.menu.setDishOptionGroups({ params: { id: sua }, body: { groupIds: [size.id] } });
  const area = await prisma.area.create({ data: { name: 'Sân' } });
  const t1 = await prisma.diningTable.create({ data: { areaId: area.id, name: 'Bàn 1' } });
  const big = size.options.find((o) => o.name === 'Lớn')!.id;
  return { admin, staff, sua, tra, t1: t1.id, big };
}

/** No login: the phone of a guest (made once the server has its address). */
const guestClient = () => clientFor();
const PHONE = 'phone-abc-123';

describe('ordering from the table QR', () => {
  it('QR codes per table; off = nothing; the menu has prices but no costs', async () => {
    const { admin, staff, t1 } = await setup();
    expect((await staff.client.tableRequests.qrCodes({ body: { renewTableId: null } })).status).toBe(403);
    const codes = (await admin.client.tableRequests.qrCodes({ body: { renewTableId: null } })).body as {
      tableId: number;
      token: string;
    }[];
    const token = codes.find((x) => x.tableId === t1)!.token;
    expect(token).toMatch(/^[A-Za-z0-9_-]{16}$/);
    // Asking again keeps the code.
    const again = (await admin.client.tableRequests.qrCodes({ body: { renewTableId: null } })).body as {
      token: string;
    }[];
    expect(again[0]!.token).toBe(token);

    expect((await guestClient().guest.menu({ params: { token } })).status).toBe(404); // QR ordering is off
    await admin.client.settings.update({ body: { settings: { qr_order_enabled: true } } });
    const m = await guestClient().guest.menu({ params: { token } });
    expect(m.status).toBe(200);
    const menu = m.body as GuestMenu;
    expect(menu).toMatchObject({ shopName: 'Quán test', tableName: 'Bàn 1', areaName: 'Sân' });
    expect(menu.dishes.map((d) => d.name).sort()).toEqual(['Trà sữa', 'Trà đá']); // not the one without a price
    expect(menu.groups[0]).toMatchObject({ name: 'Size', required: true });
    expect(JSON.stringify(menu)).not.toMatch(/cost|recipe|ingredient/i);

    // Renewing the code: the printed QR stops working.
    await admin.client.tableRequests.qrCodes({ body: { renewTableId: t1 } });
    expect((await guestClient().guest.menu({ params: { token } })).status).toBe(404);
  });

  it('a guest orders; a till accepts into the table order (or a new one); the phone sees the answer', async () => {
    const { admin, staff, sua, tra, t1, big } = await setup();
    await admin.client.settings.update({ body: { settings: { qr_order_enabled: true } } });
    const token = (
      (await admin.client.tableRequests.qrCodes({ body: { renewTableId: null } })).body as { token: string }[]
    )[0]!.token;
    const send = (body: Record<string, unknown>) =>
      guestClient().guest.send({
        params: { token },
        body: { clientId: PHONE, note: null, ...body } as never,
      });

    expect(
      (await send({ kind: 'ORDER', items: [{ dishId: sua, qty: 1, optionIds: [], note: null }] })).status,
    ).toBe(400); // size missing
    expect((await send({ kind: 'ORDER', items: [] })).status).toBe(400);
    const r = await send({
      kind: 'ORDER',
      note: 'Lên nước trước',
      items: [
        { dishId: sua, qty: 1, optionIds: [big], note: 'ít đá' },
        { dishId: tra, qty: 2, optionIds: [], note: null },
        { dishId: tra, qty: 1, optionIds: [], note: null },
      ],
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ kind: 'ORDER', status: 'PENDING', portions: 4 });

    const list = (await staff.client.tableRequests.list()).body as TableRequestDto[];
    expect(list).toHaveLength(1);
    expect(list[0]!.items).toEqual([
      { dishId: sua, name: 'Trà sữa', qty: 1, options: 'Lớn', note: 'ít đá' },
      { dishId: tra, name: 'Trà đá', qty: 3, options: '', note: null },
    ]);

    // No order on the table yet: accepting opens one, dishes not sent to the bar yet.
    const ok = await staff.client.tableRequests.accept({ params: { id: list[0]!.id }, body: {} });
    expect(ok.body).toMatchObject({ status: 'ACCEPTED', handledByName: expect.any(String) });
    const orderId = (ok.body as TableRequestDto).orderId!;
    const o = (await staff.client.orders.get({ params: { id: orderId } })).body as OrderDto;
    expect(o).toMatchObject({ channel: 'DINE_IN', tableId: t1, total: '55000' }); // 40.000 + 3 × 5.000
    expect(o.items.every((i) => i.kitchenStatus === 'NEW')).toBe(true);
    expect(o.note).toBe('QR: Lên nước trước');
    expect((await admin.client.tableRequests.accept({ params: { id: list[0]!.id }, body: {} })).status).toBe(
      409,
    );

    // A second order from the table goes into the same open order.
    const r2 = (await send({ kind: 'ORDER', items: [{ dishId: tra, qty: 1, optionIds: [], note: null }] }))
      .body as GuestRequest;
    await staff.client.tableRequests.accept({ params: { id: r2.id }, body: {} });
    expect(((await staff.client.orders.get({ params: { id: orderId } })).body as OrderDto).total).toBe(
      '60000',
    );

    // Calling staff twice is one request; rejecting shows the reason on the phone.
    const call = (await send({ kind: 'CALL', items: [] })).body as GuestRequest;
    expect(((await send({ kind: 'CALL', items: [] })).body as GuestRequest).id).toBe(call.id);
    await staff.client.tableRequests.reject({
      params: { id: call.id },
      body: { reason: 'Nhân viên đã tới bàn' },
    });
    const mine = (await guestClient().guest.mine({ params: { token }, query: { clientId: PHONE } }))
      .body as GuestRequest[];
    expect(mine.map((x) => [x.kind, x.status])).toEqual([
      ['CALL', 'REJECTED'],
      ['ORDER', 'ACCEPTED'],
      ['ORDER', 'ACCEPTED'],
    ]);
    expect(mine[0]!.rejectReason).toBe('Nhân viên đã tới bàn');
    // Another phone sees nothing of this one.
    expect(
      (
        (await guestClient().guest.mine({ params: { token }, query: { clientId: 'someone-else-1' } }))
          .body as GuestRequest[]
      ).length,
    ).toBe(0);
  });

  it('caps waiting requests; a dish sold out meanwhile puts the request back to waiting', async () => {
    const { admin, staff, tra } = await setup();
    await admin.client.settings.update({ body: { settings: { qr_order_enabled: true } } });
    const token = (
      (await admin.client.tableRequests.qrCodes({ body: { renewTableId: null } })).body as { token: string }[]
    )[0]!.token;
    const order = (clientId: string) =>
      guestClient().guest.send({
        params: { token },
        body: {
          clientId,
          kind: 'ORDER',
          note: null,
          items: [{ dishId: tra, qty: 1, optionIds: [], note: null }],
        } as never,
      });
    for (let i = 0; i < 3; i++) expect((await order(PHONE)).status).toBe(201);
    expect((await order(PHONE)).status).toBe(409); // this phone: 3 waiting
    expect((await order('phone-two-22')).status).toBe(201);
    expect((await order('phone-two-22')).status).toBe(201);
    expect((await order('phone-three-3')).status).toBe(409); // the table: 5 waiting

    const first = ((await staff.client.tableRequests.list()).body as TableRequestDto[])[0]!;
    await admin.client.menu.setAvailability({ params: { id: tra }, body: { soldOut: true } });
    const res = await staff.client.tableRequests.accept({ params: { id: first.id }, body: {} });
    expect(res.status).toBe(409);
    const back = ((await staff.client.tableRequests.list()).body as TableRequestDto[]).find(
      (x) => x.id === first.id,
    )!;
    expect(back).toMatchObject({ status: 'PENDING', handledByName: null });
  });
});
