import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/core/db';
import { toDbDate } from '../../src/domain/business-date';
import { dailyLines } from '../../src/modules/bank/bank.service';
import { businessToday } from '../../src/modules/settings/settings.service';
import type { OrderDto } from '../../src/contracts/orders.contract';
import type { BankTxnDto } from '../../src/contracts/bank.contract';
import { makeUser, resetDb, startServer, stopServer } from '../helpers/harness';
import { branchId, makeIngredient } from '../helpers/factories';

beforeAll(startServer);
afterAll(stopServer);
beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

const SEPAY_KEY = 'SEPAYKEY0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRST';
const CASSO_KEY = 'AK_CS.casso-key-0123456789';

interface SepayRow {
  id: string;
  transaction_date: string;
  account_number: string;
  transfer_type: 'in' | 'out';
  amount_in: number;
  amount_out: number;
  transaction_content: string;
  reference_number: string;
  bank_brand_name: string;
}
interface CassoRow {
  id: number;
  tid: string;
  description: string;
  amount: number;
  when: string;
  bankSubAccId: string;
  bankCodeName: string;
}

/** Fake SePay (user API v2) and Casso (v2) transaction lists. */
function mockFeeds() {
  const realFetch = globalThis.fetch;
  const state = {
    sepay: [] as SepayRow[],
    casso: [] as CassoRow[],
    revoked: false,
    calls: [] as string[],
  };
  const json = (v: unknown, status = 200) =>
    new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const auth = new Headers(init?.headers).get('authorization') ?? '';
    if (url.host === 'userapi.sepay.vn' || url.host === 'userapi-sandbox.sepay.vn') {
      state.calls.push(url.toString());
      if (state.revoked || auth !== `Bearer ${SEPAY_KEY}`)
        return json({ status: 'error', message: 'Unauthorized', error_code: 'unauthorized' }, 401);
      const from = url.searchParams.get('transaction_date_from') ?? '';
      const per = Number(url.searchParams.get('per_page'));
      const page = Number(url.searchParams.get('page'));
      const rows = state.sepay
        .filter(
          (r) => r.transfer_type === url.searchParams.get('transfer_type') && r.transaction_date >= from,
        )
        .sort((a, b) => b.transaction_date.localeCompare(a.transaction_date));
      return json({
        status: 'success',
        data: rows.slice((page - 1) * per, page * per),
        meta: {
          pagination: {
            total: rows.length,
            per_page: per,
            current_page: page,
            has_more: page * per < rows.length,
          },
        },
      });
    }
    if (url.host === 'oauth.casso.vn') {
      state.calls.push(url.toString());
      if (state.revoked || auth !== `Apikey ${CASSO_KEY}`)
        return json({ error: 401, message: 'Unauthorized Access', data: null }, 401);
      const from = url.searchParams.get('fromDate') ?? '';
      const size = Number(url.searchParams.get('pageSize'));
      const page = Number(url.searchParams.get('page'));
      const rows = state.casso
        .filter((r) => r.when.slice(0, 10) >= from)
        .sort((a, b) => b.when.localeCompare(a.when));
      const totalPages = Math.max(1, Math.ceil(rows.length / size));
      return json({
        error: 0,
        message: 'success',
        data: { page, pageSize: size, totalPages, records: rows.slice((page - 1) * size, page * size) },
      });
    }
    return realFetch(input, init);
  });
  return state;
}

/** Shop time "YYYY-MM-DD HH:MM:SS", `minutes` ago. */
const shopTime = (minutesAgo = 0) =>
  new Date(Date.now() + 7 * 3600_000 - minutesAgo * 60_000).toISOString().slice(0, 19).replace('T', ' ');

let seq = 0;
const sepayIn = (amount: number, content: string, minutesAgo = 1): SepayRow => ({
  id: `uuid-${++seq}`,
  transaction_date: shopTime(minutesAgo),
  account_number: '0123456789',
  transfer_type: 'in',
  amount_in: amount,
  amount_out: 0,
  transaction_content: content,
  reference_number: `FT${seq}`,
  bank_brand_name: 'MBBank',
});

type Client = Awaited<ReturnType<typeof makeUser>>['client'];

async function setup() {
  const admin = await makeUser({ username: 'chu', role: 'ADMIN' });
  const staff = await makeUser({ username: 'lan', role: 'STAFF' });
  await admin.client.settings.update({
    body: { settings: { bank_bin: '970422', bank_account_no: '0123456789', bank_account_name: 'QUAN TEST' } },
  });
  const c = admin.client;
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
        items: [{ ingredientId: ing.id, qty: '100', scope: 'ALL' }],
      },
    });
    return d.id;
  };
  return {
    admin,
    staff,
    d50: await dish('A', '50000'),
    d30: await dish('B', '30000'),
    d20: await dish('C', '20000'),
  };
}

async function openOrder(c: Client, dishId: number) {
  return (
    await c.orders.open({
      body: {
        channel: 'TAKEAWAY',
        tableId: null,
        deliveryAppId: null,
        appOrderCode: null,
        guestCount: 1,
        note: null,
        items: [{ dishId, qty: 1 }],
      },
    })
  ).body as OrderDto;
}

const getOrder = async (c: Client, id: number) => (await c.orders.get({ params: { id } })).body as OrderDto;

const payTransfer = (c: Client, o: OrderDto) =>
  c.orders.pay({
    params: { id: o.id },
    body: { version: o.version, payments: [{ method: 'TRANSFER', amount: o.total }], print: false },
  });

async function connectSepay(c: Client) {
  const r = await c.bank.saveConfig({
    body: { provider: 'SEPAY', token: SEPAY_KEY, sandbox: false, accountNo: null, enabled: true },
  });
  expect(r.status).toBe(200);
  return r.body;
}

describe('bank transfers (SePay)', () => {
  it('a transfer with the order code is tied to the order; the key never leaves the server', async () => {
    const { admin, staff, d50 } = await setup();
    const feed = mockFeeds();
    expect(await connectSepay(admin.client)).toMatchObject({
      provider: 'SEPAY',
      configured: true,
      enabled: true,
      accountNo: '0123456789',
      lastError: null,
    });

    const o = await openOrder(staff.client, d50);
    // Banks rewrite the content: no dash, their own prefix and suffix.
    feed.sepay.push(sepayIn(50000, `MBVCB.88123.${o.code.replace('-', '')}.CT tu 0901234567 NGUYEN VAN A`));
    feed.sepay.push({ ...sepayIn(20000, 'rut tien'), transfer_type: 'out', amount_in: 0, amount_out: 20000 });
    expect((await staff.client.bank.sync({ body: {} })).body).toEqual({ imported: 1, matched: 1 });
    expect((await getOrder(staff.client, o.id)).transferReceived).toBe('50000');

    // Read again: nothing new.
    expect((await staff.client.bank.sync({ body: {} })).body).toEqual({ imported: 0, matched: 0 });

    expect((await payTransfer(staff.client, await getOrder(staff.client, o.id))).status).toBe(200);
    const today = await businessToday();
    const day = (await staff.client.dayClosing.preview({ params: { date: today } })).body as {
      transfer: {
        expected: string;
        received: string;
        short: number;
        orders: unknown[];
        unmatched: unknown[];
      };
    };
    expect(day.transfer).toEqual({
      expected: '50000',
      received: '50000',
      short: 0,
      orders: [],
      unmatched: [],
    });

    const list = (await staff.client.bank.list({ query: { from: today, to: today, filter: 'ALL' } }))
      .body as {
      rows: BankTxnDto[];
    };
    expect(list.rows[0]).toMatchObject({
      amount: '50000',
      orderCode: o.code,
      matchKind: 'CODE',
      bankName: 'MBBank',
    });

    const row = await prisma.setting.findUniqueOrThrow({ where: { key: 'bank_feed' } });
    expect(JSON.stringify(row.value)).not.toContain(SEPAY_KEY);
    expect(JSON.stringify((await admin.client.bank.status()).body)).not.toContain(SEPAY_KEY);
    expect(JSON.stringify(await prisma.auditLog.findMany())).not.toContain(SEPAY_KEY);
    expect((await staff.client.bank.status()).status).toBe(403);
  });

  it('without the code, money goes to the one till waiting for that amount; otherwise matched by hand', async () => {
    const { admin, staff, d50, d30, d20 } = await setup();
    const feed = mockFeeds();
    await connectSepay(admin.client);
    const a = await openOrder(staff.client, d50);
    const b = await openOrder(staff.client, d30);
    expect((await staff.client.bank.watch({ body: { orderId: a.id, amount: '50000' } })).body).toEqual({
      enabled: true,
      received: '0',
    });
    feed.sepay.push(sepayIn(50000, 'chuyen tien an trua'));
    feed.sepay.push(sepayIn(30000, 'ck'));
    // Two tills waiting for 20.000: never a guess.
    const c1 = await openOrder(staff.client, d20);
    const c2 = await openOrder(staff.client, d20);
    await staff.client.bank.watch({ body: { orderId: c1.id, amount: '20000' } });
    await staff.client.bank.watch({ body: { orderId: c2.id, amount: '20000' } });
    feed.sepay.push(sepayIn(20000, 'thanh toan'));
    expect((await staff.client.bank.sync({ body: {} })).body).toEqual({ imported: 3, matched: 1 });
    expect((await getOrder(staff.client, a.id)).transferReceived).toBe('50000');

    const today = await businessToday();
    const unmatched = (
      await staff.client.bank.list({ query: { from: today, to: today, filter: 'UNMATCHED' } })
    ).body as { rows: BankTxnDto[]; totals: { received: string; matched: string; unmatched: string } };
    expect(unmatched.rows.map((r) => r.amount).sort()).toEqual(['20000', '30000']);
    expect(unmatched.totals).toMatchObject({ received: '100000', matched: '50000', unmatched: '50000' });

    const t30 = unmatched.rows.find((r) => r.amount === '30000')!;
    const m = await staff.client.bank.match({ params: { id: t30.id }, body: { orderCode: b.code } });
    expect(m.body).toMatchObject({ orderCode: b.code, matchKind: 'MANUAL', matchedByName: 'LAN' });
    expect((await getOrder(staff.client, b.id)).transferReceived).toBe('30000');
    // Staff cannot move money already tied to an order; ADMIN can, with a reason.
    expect(
      (await staff.client.bank.match({ params: { id: t30.id }, body: { orderCode: a.code } })).status,
    ).toBe(403);
    expect(
      (await staff.client.bank.unmatch({ params: { id: t30.id }, body: { reason: 'Gán nhầm đơn' } })).status,
    ).toBe(403);
    expect(
      (await admin.client.bank.unmatch({ params: { id: t30.id }, body: { reason: 'Gán nhầm đơn' } })).body,
    ).toMatchObject({
      orderId: null,
      matchKind: null,
    });
    // An unknown code is refused clearly.
    expect(
      (await staff.client.bank.match({ params: { id: t30.id }, body: { orderCode: '991231-999' } })).status,
    ).toBe(400);
  });

  it('day closing and alerts: a transfer that never arrived, money nobody claimed', async () => {
    const { admin, staff, d50, d30 } = await setup();
    const feed = mockFeeds();
    await connectSepay(admin.client);
    const today = await businessToday();
    const o = await openOrder(staff.client, d50);
    expect((await payTransfer(staff.client, o)).status).toBe(200); // the customer showed a screenshot…
    feed.sepay.push(sepayIn(30000, 'tien gi day'));
    await staff.client.bank.sync({ body: {} });

    const day = (await staff.client.dayClosing.preview({ params: { date: today } })).body as {
      transfer: {
        short: number;
        orders: { code: string; check: string; received: string }[];
        unmatched: BankTxnDto[];
      };
    };
    expect(day.transfer.short).toBe(1);
    expect(day.transfer.orders).toEqual([
      expect.objectContaining({ code: o.code, check: 'SHORT', received: '0' }),
    ]);
    expect(day.transfer.unmatched.map((t) => t.amount)).toEqual(['30000']);
    expect(await dailyLines(today)).toEqual([
      '⚠️ Chuyển khoản chưa thấy tiền về: 1 đơn (50.000 đ)',
      'Tiền về chưa rõ của đơn nào: 1 khoản (30.000 đ)',
    ]);

    // The owner's own transfer: not sales money. Only ADMIN, with a reason.
    const t = day.transfer.unmatched[0]!;
    expect(
      (await staff.client.bank.ignore({ params: { id: t.id }, body: { reason: 'Chủ quán chuyển' } })).status,
    ).toBe(403);
    expect(
      (await admin.client.bank.ignore({ params: { id: t.id }, body: { reason: 'Chủ quán chuyển' } })).body,
    ).toMatchObject({
      ignored: true,
      ignoreReason: 'Chủ quán chuyển',
    });
    const after = (await staff.client.dayClosing.preview({ params: { date: today } })).body as {
      transfer: { unmatched: unknown[] };
    };
    expect(after.transfer.unmatched).toEqual([]);
    await admin.client.bank.unignore({ params: { id: t.id }, body: {} });

    // Seen from the next day: the bell warns.
    const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86400_000).toISOString().slice(0, 10);
    await prisma.order.update({ where: { id: o.id }, data: { businessDate: toDbDate(yesterday) } });
    await prisma.bankTransaction.updateMany({ data: { businessDate: toDbDate(yesterday) } });
    expect((await admin.client.reports.dashboard()).body).toMatchObject({
      alerts: { unverifiedTransfers: 1, unmatchedTransfers: 1, bankFeedError: null },
    });

    // A transfer for a merged order follows it to the target.
    const src = await openOrder(staff.client, d30);
    const dst = await openOrder(staff.client, d30);
    feed.sepay.push(sepayIn(30000, `TT ${src.code}`));
    await staff.client.bank.sync({ body: {} });
    await staff.client.orders.merge({
      params: { id: src.id },
      body: { version: (await getOrder(staff.client, src.id)).version, targetOrderId: dst.id },
    });
    expect((await getOrder(staff.client, dst.id)).transferReceived).toBe('30000');
  });
});

describe('bank transfers (Casso)', () => {
  it('reads incoming money only, stops at what it has; a revoked key is reported', async () => {
    const { admin, staff, d50 } = await setup();
    const feed = mockFeeds();
    const o = await openOrder(staff.client, d50);
    const when = (minutesAgo: number) => shopTime(minutesAgo).replace(' ', 'T');
    feed.casso.push(
      {
        id: 1,
        tid: 'TF1',
        description: `${o.code} cam on`,
        amount: 50000,
        when: when(5),
        bankSubAccId: '0123456789',
        bankCodeName: 'acb_digi',
      },
      {
        id: 2,
        tid: 'TF2',
        description: 'chuyen di',
        amount: -20000,
        when: when(4),
        bankSubAccId: '0123456789',
        bankCodeName: 'acb_digi',
      },
      {
        id: 3,
        tid: 'TF3',
        description: 'tk khac',
        amount: 10000,
        when: when(3),
        bankSubAccId: '999888777',
        bankCodeName: 'vcb',
      },
    );
    // Wrong key: refused before saving.
    const bad = await admin.client.bank.saveConfig({
      body: {
        provider: 'CASSO',
        token: 'AK_CS.wrong-key-000',
        sandbox: false,
        accountNo: null,
        enabled: true,
      },
    });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toContain('Casso không nhận mã API');
    const ok = await admin.client.bank.saveConfig({
      body: { provider: 'CASSO', token: CASSO_KEY, sandbox: false, accountNo: null, enabled: true },
    });
    expect(ok.body).toMatchObject({ provider: 'CASSO', accountNo: '0123456789' });
    expect(feed.calls.at(-1)).toContain('sort=DESC');

    // Only money in, only the shop's account.
    expect((await staff.client.bank.sync({ body: {} })).body).toEqual({ imported: 1, matched: 1 });
    expect((await getOrder(staff.client, o.id)).transferReceived).toBe('50000');
    feed.casso.push({
      id: 4,
      tid: 'TF4',
      description: 'ck',
      amount: 15000,
      when: when(1),
      bankSubAccId: '0123456789',
      bankCodeName: 'acb_digi',
    });
    expect((await staff.client.bank.sync({ body: {} })).body).toEqual({ imported: 1, matched: 0 });

    feed.revoked = true;
    const r = await staff.client.bank.sync({ body: {} });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toContain('Casso từ chối mã API');
    expect((await admin.client.bank.status()).body).toMatchObject({
      lastError: expect.stringContaining('từ chối'),
    });
    expect((await admin.client.reports.dashboard()).body).toMatchObject({
      alerts: { bankFeedError: expect.stringContaining('từ chối') },
    });

    // Turned off: nothing is read, the till is told.
    await admin.client.bank.saveConfig({
      body: { provider: 'CASSO', sandbox: false, accountNo: null, enabled: false },
    });
    expect((await staff.client.bank.watch({ body: { orderId: o.id, amount: '50000' } })).body).toMatchObject({
      enabled: false,
    });
    const calls = feed.calls.length;
    expect((await staff.client.bank.sync({ body: {} })).body).toEqual({ imported: 0, matched: 0 });
    expect(feed.calls.length).toBe(calls);
  });
});
