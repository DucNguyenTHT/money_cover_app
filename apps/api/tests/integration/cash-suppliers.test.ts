import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/core/db';
import { businessToday } from '../../src/modules/settings/settings.service';
import type { ReceiptDetail, ReceiptInput } from '../../src/contracts/inventory.contract';
import type { SupplierDto } from '../../src/contracts/suppliers.contract';
import { makeUser, resetDb, startServer, stopServer } from '../helpers/harness';
import { makeIngredient } from '../helpers/factories';

beforeAll(startServer);
afterAll(stopServer);
beforeEach(resetDb);

type Client = Awaited<ReturnType<typeof makeUser>>['client'];

const entry = (date: string, direction: 'IN' | 'OUT', amount: string, category = 'Chi khác') => ({
  businessDate: date,
  direction,
  category,
  amount,
  note: null,
});

describe('cash book (sổ quỹ)', () => {
  it('counts in the cash expected at closing and flags a closed day to redo', async () => {
    const admin = await makeUser({ username: 'chu', role: 'ADMIN' });
    const staff = await makeUser({ username: 'thungan', role: 'STAFF' });
    const today = await businessToday();

    const opening = await staff.client.cash.create({
      body: entry(today, 'IN', '500000', 'Tiền lẻ đầu ngày'),
    });
    expect(opening.status).toBe(201);
    await staff.client.cash.create({ body: entry(today, 'OUT', '120000', 'Chi chợ') });

    const preview = (await admin.client.dayClosing.preview({ params: { date: today } })).body as {
      cashSales: string;
      cashIn: string;
      cashOut: string;
      expectedCash: string;
    };
    expect(preview).toMatchObject({
      cashSales: '0',
      cashIn: '500000',
      cashOut: '120000',
      expectedCash: '380000',
    });

    const closed = await admin.client.dayClosing.close({
      params: { date: today },
      body: { countedCash: '380000', note: null },
    });
    expect(closed.status).toBe(200);
    expect((closed.body as { diff: string }).diff).toBe('0');

    // Money taken out after closing: the closing must be redone.
    await staff.client.cash.create({ body: entry(today, 'OUT', '50000') });
    const again = (await admin.client.dayClosing.preview({ params: { date: today } })).body as {
      expectedCash: string;
      closing: { needsReclose: boolean };
    };
    expect(again.expectedCash).toBe('330000');
    expect(again.closing.needsReclose).toBe(true);

    const list = await staff.client.cash.list({ query: { from: today, to: today } });
    expect(list.body).toMatchObject({ totalIn: '500000', totalOut: '170000' });
  });

  it('refuses future days; only the author (same day) or ADMIN cancels, always with a reason', async () => {
    const admin = await makeUser({ username: 'chu', role: 'ADMIN' });
    const a = await makeUser({ username: 'a', role: 'STAFF' });
    const b = await makeUser({ username: 'b', role: 'STAFF' });
    const today = await businessToday();

    const future = await a.client.cash.create({ body: entry('2099-01-01', 'OUT', '1000') });
    expect(future.status).toBe(400);

    const e = (await a.client.cash.create({ body: entry(today, 'OUT', '20000') })).body as { id: number };
    const byOther = await b.client.cash.cancel({ params: { id: e.id }, body: { reason: 'ghi nhầm' } });
    expect(byOther.status).toBe(403);
    const byAuthor = await a.client.cash.cancel({ params: { id: e.id }, body: { reason: 'ghi nhầm' } });
    expect(byAuthor.status).toBe(200);
    expect(byAuthor.body).toMatchObject({ cancelled: true, cancelReason: 'ghi nhầm' });

    const e2 = (await a.client.cash.create({ body: entry(today, 'IN', '20000') })).body as { id: number };
    expect(
      (await admin.client.cash.cancel({ params: { id: e2.id }, body: { reason: 'ghi sai số' } })).status,
    ).toBe(200);

    const list = (await admin.client.cash.list({ query: { from: today, to: today } })).body as {
      totalIn: string;
      totalOut: string;
    };
    expect(list).toMatchObject({ totalIn: '0', totalOut: '0' });
  });
});

describe('suppliers and payables (công nợ)', () => {
  const receipt = (
    c: Client,
    date: string,
    ingredientId: number,
    over: Partial<ReceiptInput> & { qty?: string; price?: string } = {},
  ) =>
    c.inventory.createReceipt({
      body: {
        kind: 'PURCHASE',
        date,
        supplier: over.supplier ?? null,
        note: null,
        items: [
          { ingredientId, qty: over.qty ?? '10', unitPrice: over.price ?? '100000', unitMode: 'STOCK' },
        ],
        payment: over.payment ?? null,
      },
    });
  const supplier = async (c: Client, name: string) =>
    ((await c.suppliers.list()).body as SupplierDto[]).find((s) => s.name === name)!;

  it('a receipt on credit becomes debt; payments bring it down; cash ones go to the cash book', async () => {
    const { client } = await makeUser({ username: 'chu', role: 'ADMIN' });
    const today = await businessToday();
    const ing = await makeIngredient();

    const r1 = (await receipt(client, today, ing.id, { supplier: 'Chị Lan' })).body as ReceiptDetail;
    expect(r1).toMatchObject({ supplier: 'Chị Lan', total: '1000000', paid: '0' });
    // Same supplier whatever the letter case.
    const r2 = (await receipt(client, today, ing.id, { supplier: 'chị lan', qty: '5' }))
      .body as ReceiptDetail;
    expect(r2.supplier).toBe('Chị Lan');
    let lan = await supplier(client, 'Chị Lan');
    expect(lan).toMatchObject({ purchased: '1500000', paid: '0', balance: '1500000', receiptCount: 2 });

    // Pay 1.2M in cash: the oldest receipt is paid off first.
    const pay = await client.suppliers.pay({
      params: { id: lan.id },
      body: { date: today, amount: '1200000', method: 'CASH', receiptId: null, note: null },
    });
    expect(pay.status).toBe(201);
    expect(pay.body).toMatchObject({ paid: '1200000', balance: '300000' });
    const book = (await client.cash.list({ query: { from: today, to: today } })).body as {
      entries: { category: string; amount: string; source: string | null; note: string | null }[];
    };
    expect(book.entries).toMatchObject([
      { category: 'Trả nhà cung cấp', amount: '1200000', source: 'SUPPLIER_PAYMENT', note: 'Chị Lan' },
    ]);
    const auto = await prisma.cashEntry.findFirstOrThrow();
    const cancelHere = await client.cash.cancel({
      params: { id: auto.id },
      body: { reason: 'thử huỷ ở sổ quỹ' },
    });
    expect(cancelHere.status).toBe(403);

    // Transfers do not touch the till.
    await client.suppliers.pay({
      params: { id: lan.id },
      body: { date: today, amount: '300000', method: 'TRANSFER', receiptId: r2.id, note: 'CK' },
    });
    lan = await supplier(client, 'Chị Lan');
    expect(lan.balance).toBe('0');
    expect(await prisma.cashEntry.count()).toBe(1);

    const ledger = (await client.suppliers.ledger({ params: { id: lan.id } })).body as {
      entries: { kind: string; amount: string; balance: string; remaining: string | null }[];
    };
    expect(ledger.entries.map((e) => [e.kind, e.amount, e.balance, e.remaining])).toEqual([
      ['PAYMENT', '-300000', '0', null],
      ['PAYMENT', '-1200000', '300000', null],
      ['RECEIPT', '500000', '1500000', '0'],
      ['RECEIPT', '1000000', '1000000', '0'],
    ]);
  });

  it('paid on the spot: cash without a supplier name goes to "Mua lẻ"; more than the total is refused', async () => {
    const { client } = await makeUser({ username: 'thungan', role: 'STAFF' });
    const today = await businessToday();
    const ing = await makeIngredient();

    const r = (
      await receipt(client, today, ing.id, {
        payment: { method: 'CASH', amount: null },
        qty: '2',
        price: '35000',
      })
    ).body as ReceiptDetail;
    expect(r).toMatchObject({ supplier: 'Mua lẻ', total: '70000', paid: '70000' });
    const book = (await client.cash.list({ query: { from: today, to: today } })).body as { totalOut: string };
    expect(book.totalOut).toBe('70000');

    const part = (
      await receipt(client, today, ing.id, {
        supplier: 'Đại lý bia',
        payment: { method: 'TRANSFER', amount: '400000' },
      })
    ).body as ReceiptDetail;
    expect(part).toMatchObject({ total: '1000000', paid: '400000' });
    expect((await supplier(client, 'Đại lý bia')).balance).toBe('600000');

    const tooMuch = await receipt(client, today, ing.id, {
      supplier: 'Đại lý bia',
      payment: { method: 'CASH', amount: '2000000' },
    });
    expect(tooMuch.status).toBe(400);
    expect(await prisma.receipt.count()).toBe(2);
  });

  it('payments follow an edited receipt (also to a new supplier) and are cancelled with a deleted one', async () => {
    const admin = await makeUser({ username: 'chu', role: 'ADMIN' });
    const staff = await makeUser({ username: 'thungan', role: 'STAFF' });
    const today = await businessToday();
    const ing = await makeIngredient();

    const r = (
      await receipt(staff.client, today, ing.id, {
        supplier: 'Anh Tư',
        payment: { method: 'CASH', amount: null },
      })
    ).body as ReceiptDetail;
    const upd = await staff.client.inventory.updateReceipt({
      params: { id: r.id },
      body: {
        kind: 'PURCHASE',
        date: today,
        supplier: 'Chú Ba',
        note: null,
        items: [{ ingredientId: ing.id, qty: '10', unitPrice: '100000', unitMode: 'STOCK' }],
        reason: 'nhầm nhà cung cấp',
      },
    });
    expect(upd.status).toBe(200);
    const moved = upd.body as ReceiptDetail;
    expect(moved).toMatchObject({ supplier: 'Chú Ba', paid: '1000000' });
    expect((await supplier(admin.client, 'Anh Tư')).paid).toBe('0');
    expect((await supplier(admin.client, 'Chú Ba')).balance).toBe('0');
    const code = `PN${String(moved.id).padStart(6, '0')}`;
    expect((await prisma.cashEntry.findFirstOrThrow()).note).toBe(`Chú Ba · ${code}`);

    // Staff may not cancel a payment; deleting the receipt cancels it with its cash entry.
    const p = await prisma.supplierPayment.findFirstOrThrow();
    const denied = await staff.client.suppliers.cancelPayment({
      params: { id: p.id },
      body: { reason: 'không trả nữa' },
    });
    expect(denied.status).toBe(403);
    const del = await staff.client.inventory.deleteReceipt({
      params: { id: moved.id },
      body: { reason: 'trả hàng' },
    });
    expect(del.status).toBe(200);
    expect(await prisma.supplierPayment.findFirstOrThrow()).toMatchObject({
      cancelReason: `Xoá phiếu nhập ${code}: trả hàng`,
    });
    expect((await prisma.cashEntry.findFirstOrThrow()).cancelledAt).not.toBeNull();
    expect((await supplier(admin.client, 'Chú Ba')).balance).toBe('0');
  });

  it('ADMIN edits suppliers (no duplicate names; a rename shows on its receipts) and cancels payments', async () => {
    const { client } = await makeUser({ username: 'chu', role: 'ADMIN' });
    const today = await businessToday();
    const ing = await makeIngredient();
    await receipt(client, today, ing.id, { supplier: 'Gas Hưng' });
    const gas = await supplier(client, 'Gas Hưng');

    const dup = await client.suppliers.create({
      body: { name: 'gas hưng', phone: null, address: null, note: null, active: true },
    });
    expect(dup.status).toBe(409);
    const renamed = await client.suppliers.update({
      params: { id: gas.id },
      body: { name: 'Gas Hưng Thịnh', phone: '0909', address: null, note: null, active: true },
    });
    expect(renamed.status).toBe(200);
    const [row] = (await client.inventory.listReceipts({ query: { month: today.slice(0, 7) } })).body as {
      supplier: string;
    }[];
    expect(row!.supplier).toBe('Gas Hưng Thịnh');

    await client.suppliers.pay({
      params: { id: gas.id },
      body: { date: today, amount: '200000', method: 'CASH', receiptId: null, note: null },
    });
    const p = await prisma.supplierPayment.findFirstOrThrow();
    const cancelled = await client.suppliers.cancelPayment({
      params: { id: p.id },
      body: { reason: 'trả nhầm' },
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({ paid: '0', balance: '1000000' });
    expect((await prisma.cashEntry.findFirstOrThrow()).cancelReason).toBe('trả nhầm');
  });
});
