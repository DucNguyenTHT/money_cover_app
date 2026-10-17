import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma, inTx } from '../../src/core/db';
import { createIssueFromLots } from '../../src/modules/inventory/stock-engine';
import { makeUser, resetDb, startServer, stopServer } from '../helpers/harness';
import { branchId, makeIngredient } from '../helpers/factories';

beforeAll(startServer);
afterAll(stopServer);
beforeEach(resetDb);

type Client = Awaited<ReturnType<typeof makeUser>>['client'];

const receipt = (
  client: Client,
  date: string,
  ingredientId: number,
  qty: string,
  unitPrice: string,
  unitMode: 'STOCK' | 'PURCHASE' = 'STOCK',
  kind: 'PURCHASE' | 'OPENING' = 'PURCHASE',
) =>
  client.inventory.createReceipt({
    body: {
      kind,
      date,
      supplier: kind === 'PURCHASE' ? 'Chợ Bình Điền' : null,
      note: null,
      items: [{ ingredientId, qty, unitPrice, unitMode }],
    },
  });

describe('receipts & FIFO issues', () => {
  it('values a manual issue FIFO: 15 kg from 10@100 + 10@120 = 1.600', async () => {
    const { client } = await makeUser({ username: 'thungan', role: 'STAFF' });
    const beef = await makeIngredient({ name: 'Thịt bò' });
    expect((await receipt(client, '2026-10-01', beef.id, '10', '100')).status).toBe(201);
    expect((await receipt(client, '2026-10-02', beef.id, '10', '120')).status).toBe(201);

    const issue = await client.inventory.createIssue({
      body: {
        reason: 'DISPOSAL',
        date: '2026-10-03',
        note: 'hỏng',
        items: [{ ingredientId: beef.id, qty: '15', lotId: null }],
      },
    });
    expect(issue.status).toBe(201);
    expect(issue.body).toMatchObject({ costTotal: '1600', pendingQty: '0' });

    const stock = (await client.inventory.stock()).body as {
      ingredientId: number;
      qtyOnHand: string;
      value: string;
    }[];
    expect(stock.find((r) => r.ingredientId === beef.id)).toMatchObject({ qtyOnHand: '5', value: '600' });
  });

  it('refuses manual issues beyond stock and names the shortage', async () => {
    const { client } = await makeUser({ username: 'thungan', role: 'STAFF' });
    const beef = await makeIngredient({ name: 'Thịt bò' });
    await receipt(client, '2026-10-01', beef.id, '2', '100');
    const res = await client.inventory.createIssue({
      body: {
        reason: 'INTERNAL_USE',
        date: '2026-10-03',
        note: null,
        items: [{ ingredientId: beef.id, qty: '3', lotId: null }],
      },
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { message: expect.stringContaining('Thịt bò thiếu 1 kg') } });
  });

  it('only uses lots dated on/before the issue date', async () => {
    const { client } = await makeUser({ username: 'thungan', role: 'STAFF' });
    const beef = await makeIngredient();
    await receipt(client, '2026-10-10', beef.id, '5', '100');
    const res = await client.inventory.createIssue({
      body: {
        reason: 'DISPOSAL',
        date: '2026-10-05',
        note: null,
        items: [{ ingredientId: beef.id, qty: '1', lotId: null }],
      },
    });
    expect(res.status).toBe(400);
  });

  it('deleting an issue restores the exact lots; used receipts cannot be edited or deleted', async () => {
    const { client } = await makeUser({ username: 'thungan', role: 'STAFF' });
    const beef = await makeIngredient();
    const r = await receipt(client, '2026-10-01', beef.id, '10', '100');
    const rid = (r.body as { id: number }).id;
    const issue = await client.inventory.createIssue({
      body: {
        reason: 'DISPOSAL',
        date: '2026-10-02',
        note: null,
        items: [{ ingredientId: beef.id, qty: '4', lotId: null }],
      },
    });
    const iid = (issue.body as { id: number }).id;

    const del = await client.inventory.deleteReceipt({ params: { id: rid }, body: { reason: 'nhập nhầm' } });
    expect(del.status).toBe(409);
    expect(del.body).toMatchObject({ error: { code: 'LOT_USED' } });

    expect(
      (await client.inventory.deleteIssue({ params: { id: iid }, body: { reason: 'xuất nhầm' } })).status,
    ).toBe(200);
    const lot = await prisma.lot.findFirstOrThrow({ where: { ingredientId: beef.id } });
    expect(lot.qtyRemaining.toString()).toBe('10');

    const upd = await client.inventory.updateReceipt({
      params: { id: rid },
      body: {
        kind: 'PURCHASE',
        date: '2026-10-01',
        supplier: 'Chợ',
        note: null,
        reason: 'sửa giá',
        items: [{ ingredientId: beef.id, qty: '10', unitPrice: '110', unitMode: 'STOCK' }],
      },
    });
    expect(upd.status).toBe(200);
    expect(upd.body).toMatchObject({ total: '1100' });
    expect(await prisma.auditLog.count({ where: { entity: 'receipt', action: 'UPDATE' } })).toBe(1);
  });

  it('converts purchase units: 2 thùng × 24 lon at 240.000 → 48 lon at 10.000', async () => {
    const { client } = await makeUser({ username: 'thungan', role: 'STAFF' });
    const coke = await makeIngredient({
      name: 'Coca',
      unit: 'lon',
      purchaseUnit: 'thùng',
      purchaseFactor: '24',
    });
    const res = await receipt(client, '2026-10-01', coke.id, '2', '240000', 'PURCHASE');
    expect(res.body).toMatchObject({
      total: '480000',
      items: [{ qty: '48', unitPrice: '10000', purchaseUnitQty: '2' }],
    });
  });

  it('opening stock creates lots but is not a purchase in price history', async () => {
    const { client } = await makeUser({ username: 'thungan', role: 'STAFF' });
    const beef = await makeIngredient();
    await receipt(client, '2026-09-30', beef.id, '7', '250000', 'STOCK', 'OPENING');
    await receipt(client, '2026-10-01', beef.id, '3', '260000');
    const hist = (await client.inventory.priceHistory({ query: { ingredientId: beef.id } }))
      .body as unknown[];
    expect(hist).toHaveLength(1);
    const stock = (await client.inventory.stock()).body as { ingredientId: number; qtyOnHand: string }[];
    expect(stock.find((r) => r.ingredientId === beef.id)?.qtyOnHand).toBe('10');
  });

  it('supplier return takes the chosen lot, not FIFO', async () => {
    const { client } = await makeUser({ username: 'thungan', role: 'STAFF' });
    const beef = await makeIngredient();
    await receipt(client, '2026-10-01', beef.id, '10', '100');
    await receipt(client, '2026-10-02', beef.id, '10', '120');
    const lots = (await client.inventory.lots({ query: { ingredientId: beef.id, open: 'true' } })).body as {
      id: number;
      unitPrice: string;
    }[];
    const newer = lots.find((l) => l.unitPrice === '120')!;
    expect(
      (
        await client.inventory.createIssue({
          body: {
            reason: 'SUPPLIER_RETURN',
            date: '2026-10-03',
            note: null,
            items: [{ ingredientId: beef.id, qty: '2', lotId: null }],
          },
        })
      ).status,
    ).toBe(400);
    const res = await client.inventory.createIssue({
      body: {
        reason: 'SUPPLIER_RETURN',
        date: '2026-10-03',
        note: 'hàng kém',
        items: [{ ingredientId: beef.id, qty: '2', lotId: newer.id }],
      },
    });
    expect(res.body).toMatchObject({ costTotal: '240' });
    const after = await prisma.lot.findUniqueOrThrow({ where: { id: newer.id } });
    expect(after.qtyRemaining.toString()).toBe('8');
  });
});

describe('nợ kho', () => {
  it('sells beyond stock at the last price, then a new receipt settles it at the real price', async () => {
    const { client, user } = await makeUser({ username: 'thungan', role: 'STAFF' });
    const beef = await makeIngredient();
    await receipt(client, '2026-10-01', beef.id, '2', '100');
    const bid = await branchId();
    const { issueId, costTotal } = await inTx((tx) =>
      createIssueFromLots(tx, {
        branchId: bid,
        date: '2026-10-02',
        reason: 'SALE_USE',
        createdById: user.id,
        allowPending: true,
        lines: [{ ingredientId: beef.id, qty: 5 }],
      }),
    );
    expect(costTotal.toNumber()).toBe(500); // 2 @100 + 3 pending @100 (last price)
    expect((await client.inventory.pending()).body).toHaveLength(1);

    await receipt(client, '2026-10-03', beef.id, '10', '120');
    const item = await prisma.issueItem.findFirstOrThrow({ where: { issueId } });
    expect(item.pendingQty.toString()).toBe('0');
    expect(item.costTotal.toString()).toBe('560'); // 2 @100 + 3 @120
    expect((await client.inventory.pending()).body).toHaveLength(0);
    const stock = (await client.inventory.stock()).body as { ingredientId: number; qtyOnHand: string }[];
    expect(stock.find((r) => r.ingredientId === beef.id)?.qtyOnHand).toBe('7');
  });
});

describe('period lock', () => {
  it('refuses documents dated in a locked month', async () => {
    const { client, user } = await makeUser({ username: 'quanly', role: 'ADMIN' });
    const beef = await makeIngredient();
    await prisma.periodLock.create({
      data: { branchId: await branchId(), year: 2026, month: 9, lockedById: user.id },
    });
    const res = await receipt(client, '2026-09-15', beef.id, '1', '100');
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: { code: 'PERIOD_LOCKED' } });
  });
});

describe('roles', () => {
  it('kitchen accounts cannot use inventory endpoints', async () => {
    const { client } = await makeUser({ username: 'bep', role: 'KITCHEN', station: 'KITCHEN' });
    expect((await client.inventory.stock()).status).toBe(403);
  });
});
