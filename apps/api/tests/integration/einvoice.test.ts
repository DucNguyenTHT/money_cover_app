import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/core/db';
import { toDbDate } from '../../src/domain/business-date';
import { processDue } from '../../src/modules/einvoice/einvoice.service';
import type { OrderDto } from '../../src/contracts/orders.contract';
import type { EInvoiceDto } from '../../src/contracts/einvoice.contract';
import { makeUser, resetDb, startServer, stopServer } from '../helpers/harness';
import { branchId, makeIngredient } from '../helpers/factories';

beforeAll(startServer);
afterAll(stopServer);
beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

type Client = Awaited<ReturnType<typeof makeUser>>['client'];

async function setup() {
  const admin = await makeUser({ username: 'chu', role: 'ADMIN' });
  const staff = await makeUser({ username: 'lan', role: 'STAFF' });
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
  const d = (
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
    params: { id: d.id },
    body: {
      effectiveFrom: '2026-01-01',
      note: null,
      items: [{ ingredientId: ing.id, qty: '100', scope: 'ALL' }],
    },
  });
  return { admin, staff, pho: d.id };
}

async function sell(c: Client, dishId: number, einvoice?: object) {
  const o = (
    await c.orders.open({
      body: {
        channel: 'TAKEAWAY',
        tableId: null,
        deliveryAppId: null,
        appOrderCode: null,
        guestCount: 1,
        note: null,
        items: [{ dishId, qty: 2 }],
      },
    })
  ).body as OrderDto;
  const r = await c.orders.pay({
    params: { id: o.id },
    body: {
      version: o.version,
      payments: [{ method: 'CASH', amount: o.total }],
      print: false,
      ...(einvoice ? { einvoice } : {}),
    },
  });
  return r;
}

const paidOrder = (r: Awaited<ReturnType<typeof sell>>) => (r.body as { order: OrderDto }).order;

describe('e-invoices (giả lập)', () => {
  it('automatic: every paid order gets an invoice on its bill; cancelling it issues a full decrease', async () => {
    const { admin, staff, pho } = await setup();
    // Not set up: nothing happens.
    expect(paidOrder(await sell(staff.client, pho)).einvoice).toBeNull();

    const cfg = await admin.client.einvoice.saveConfig({
      body: {
        provider: 'MOCK',
        sandbox: false,
        enabled: true,
        mode: 'AUTO',
        providerAccountId: null,
        templateCode: null,
        invoiceSeries: null,
      },
    });
    expect(cfg.body).toMatchObject({
      provider: 'MOCK',
      enabled: true,
      mode: 'AUTO',
      templateCode: '2',
      invoiceSeries: 'C26MGL',
    });
    expect((await staff.client.einvoice.posInfo()).body).toEqual({
      enabled: true,
      mode: 'AUTO',
      provider: 'MOCK',
    });
    expect((await staff.client.einvoice.config()).status).toBe(403);

    const r = await sell(staff.client, pho, {
      buyer: { name: 'Công ty ABC', taxCode: '0101234567', address: 'Hà Nội', email: 'ketoan@abc.vn' },
    });
    const o = paidOrder(r);
    expect(o.einvoice).toMatchObject({
      provider: 'MOCK',
      status: 'ISSUED',
      series: 'GIẢ LẬP',
      adjustment: null,
    });
    expect(o.einvoice!.invoiceNo).toMatch(/^GL/);
    expect(o.einvoice!.lookupCode).toHaveLength(8);
    const bill = (await staff.client.orders.bill({ params: { id: o.id } })).body as { order: OrderDto };
    expect(bill.order.einvoice?.status).toBe('ISSUED');

    const today = o.businessDate;
    const list = (await admin.client.einvoice.list({ query: { from: today, to: today } })).body as {
      rows: EInvoiceDto[];
      counts: Record<string, number>;
    };
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]).toMatchObject({
      orderCode: o.code,
      amount: '120000',
      buyer: { name: 'Công ty ABC', taxCode: '0101234567' },
    });
    expect(list.counts.ISSUED).toBe(1);

    await staff.client.orders.cancel({
      params: { id: o.id },
      body: { reason: 'Khách đổi ý', wastedItemIds: [] },
    });
    await processDue();
    const after = (await staff.client.orders.get({ params: { id: o.id } })).body as OrderDto;
    expect(after.einvoice).toMatchObject({ status: 'ISSUED', adjustment: 'ISSUED' });
    const adj = await prisma.eInvoice.findFirstOrThrow({ where: { kind: 'ADJUSTMENT' } });
    expect(adj.amount.toString()).toBe('-120000');
  });

  it('on demand: only when the cashier asks (with a checked buyer); a forgotten one can be issued later', async () => {
    const { admin, staff, pho } = await setup();
    await admin.client.einvoice.saveConfig({
      body: {
        provider: 'MOCK',
        sandbox: false,
        enabled: true,
        mode: 'MANUAL',
        providerAccountId: null,
        templateCode: null,
        invoiceSeries: null,
      },
    });
    const plain = paidOrder(await sell(staff.client, pho));
    expect(plain.einvoice).toBeNull();
    const bad = await sell(staff.client, pho, { issue: true, buyer: { name: 'A', taxCode: '123' } });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toContain('Mã số thuế');
    const asked = paidOrder(await sell(staff.client, pho, { issue: true }));
    expect(asked.einvoice?.status).toBe('ISSUED');

    const later = await staff.client.einvoice.issueForOrder({
      params: { orderId: plain.id },
      body: { buyer: { name: 'Nguyễn Văn A', email: 'a@gmail.com' } },
    });
    expect(later.body).toMatchObject({ status: 'ISSUED', buyer: { name: 'Nguyễn Văn A' } });
    // Twice: the same invoice, never a second one.
    const again = await staff.client.einvoice.issueForOrder({ params: { orderId: plain.id }, body: {} });
    expect((again.body as EInvoiceDto).id).toBe((later.body as EInvoiceDto).id);
  });
});

/** Fake SePay eInvoice API. */
function mockSepay(opts: { offline?: boolean; refuse?: string; pendingChecks?: number } = {}) {
  const realFetch = globalThis.fetch;
  const state = {
    created: [] as Record<string, unknown>[],
    adjusted: [] as Record<string, unknown>[],
    checks: 0,
    offline: !!opts.offline,
    refuse: opts.refuse ?? null,
  };
  const json = (v: unknown, status = 200) =>
    new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
  const invoices = new Map<string, { ref: string; no: string; pending: number }>();
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.host !== 'einvoice-api-sandbox.sepay.vn' && url.host !== 'einvoice-api.sepay.vn')
      return realFetch(input, init);
    if (state.offline) throw new TypeError('fetch failed');
    const auth = new Headers(init?.headers).get('authorization') ?? '';
    if (url.pathname === '/v1/token') {
      if (auth !== `Basic ${Buffer.from('cid:secret-123').toString('base64')}`)
        return json(
          { success: false, error: { code: 'BAD_REQUEST', message: 'Invalid client_id or client_secret.' } },
          401,
        );
      return json({ success: true, data: { access_token: 'TOK', token_type: 'Bearer', expires_in: 86400 } });
    }
    if (auth !== 'Bearer TOK') return json({ success: false, message: 'Unauthorized' }, 401);
    if (url.pathname === '/v1/provider-accounts')
      return json({ success: true, data: [{ id: 'acc-1', provider: 'matbao', active: true }] });
    if (url.pathname === '/v1/provider-accounts/acc-1')
      return json({
        success: true,
        data: {
          id: 'acc-1',
          provider: 'matbao',
          active: true,
          templates: [
            { template_code: '2', invoice_series: 'C26MAA', invoice_label: '2 - C26MAA - Hóa đơn bán hàng' },
          ],
        },
      });
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    if (url.pathname === '/v1/invoices/create' || url.pathname === '/v1/invoices/adjust') {
      if (state.refuse)
        return json(
          { success: false, error: { code: state.refuse, message: 'Đăng ký chưa được duyệt' } },
          422,
        );
      (url.pathname.endsWith('create') ? state.created : state.adjusted).push(body);
      const ref = String(body.reference_code);
      invoices.set(ref, { ref, no: String(500 + invoices.size), pending: opts.pendingChecks ?? 1 });
      return json(
        { success: true, data: { tracking_code: `T-${ref}`, tracking_url: '', message: 'ok' } },
        202,
      );
    }
    const m = /^\/v1\/invoices\/(create|adjust)\/check\/T-(.+)$/.exec(url.pathname);
    if (m) {
      state.checks++;
      const inv = invoices.get(decodeURIComponent(m[2]!))!;
      if (inv.pending-- > 0)
        return json({
          success: true,
          data: { reference_code: inv.ref, status: 'Pending', message: 'Đang xử lý' },
        });
      return json({
        success: true,
        data: {
          reference_code: inv.ref,
          status: 'Success',
          message: 'Xuất hóa đơn điện tử thành công',
          invoice: {
            reference_code: inv.ref,
            invoice_number: inv.no,
            status: 'issued',
            pdf_url: `https://hd.example/${inv.no}.pdf`,
          },
        },
      });
    }
    return json({ success: false, message: `unexpected ${url.pathname}` }, 404);
  });
  return state;
}

const sepayConfig = (enabled = true) => ({
  provider: 'SEPAY' as const,
  sandbox: true,
  clientId: 'cid',
  clientSecret: 'secret-123',
  enabled,
  mode: 'AUTO' as const,
  providerAccountId: 'acc-1',
  templateCode: '2',
  invoiceSeries: 'C26MAA',
});

describe('e-invoices (SePay eInvoice)', () => {
  it('lists the registered templates, checks them before turning on, keeps the secret on the server', async () => {
    const { admin } = await setup();
    mockSepay();
    const wrong = await admin.client.einvoice.accounts({
      body: { provider: 'SEPAY', sandbox: true, clientId: 'cid', clientSecret: 'nope' },
    });
    expect(wrong.status).toBe(400);
    expect(JSON.stringify(wrong.body)).toContain('không nhận Client ID');
    const acc = await admin.client.einvoice.accounts({
      body: { provider: 'SEPAY', sandbox: true, clientId: 'cid', clientSecret: 'secret-123' },
    });
    expect(acc.body).toEqual([
      {
        id: 'acc-1',
        provider: 'matbao',
        active: true,
        templates: [{ templateCode: '2', invoiceSeries: 'C26MAA', label: '2 - C26MAA - Hóa đơn bán hàng' }],
      },
    ]);
    const badSeries = await admin.client.einvoice.saveConfig({
      body: { ...sepayConfig(), invoiceSeries: 'C26XXX' },
    });
    expect(badSeries.status).toBe(400);
    const ok = await admin.client.einvoice.saveConfig({ body: sepayConfig() });
    expect(ok.body).toMatchObject({
      provider: 'SEPAY',
      enabled: true,
      clientId: 'cid',
      hasSecret: true,
      invoiceSeries: 'C26MAA',
    });
    // Saved again without the secret: kept.
    expect(
      (await admin.client.einvoice.saveConfig({ body: { ...sepayConfig(), clientSecret: undefined } }))
        .status,
    ).toBe(200);
    const row = await prisma.setting.findUniqueOrThrow({ where: { key: 'einvoice' } });
    expect(JSON.stringify(row.value)).not.toContain('secret-123');
    expect(JSON.stringify(await prisma.auditLog.findMany())).not.toContain('secret-123');
  });

  it('issues asynchronously, follows the tracking code, prints the number; a cancel sends a decrease', async () => {
    const { admin, staff, pho } = await setup();
    const api = mockSepay({ pendingChecks: 1 });
    await admin.client.einvoice.saveConfig({ body: sepayConfig() });
    const o = paidOrder(await sell(staff.client, pho));
    expect(o.einvoice).toMatchObject({
      provider: 'SEPAY',
      status: 'ISSUED',
      invoiceNo: '500',
      series: 'C26MAA',
      lookupUrl: 'https://hd.example/500.pdf',
    });
    const sent = api.created[0]!;
    expect(sent).toMatchObject({
      template_code: '2',
      invoice_series: 'C26MAA',
      provider_account_id: 'acc-1',
      payment_method: 'TM',
      is_draft: false,
      total_amount: 120000,
      buyer: { name: 'Người mua không lấy hoá đơn' },
    });
    expect(sent.items).toEqual([
      expect.objectContaining({ item_name: 'Phở bò', quantity: 2, unit_price: 60000, discount_amount: 0 }),
    ]);

    await staff.client.orders.cancel({
      params: { id: o.id },
      body: { reason: 'Khách đổi ý', wastedItemIds: [] },
    });
    await processDue();
    await prisma.eInvoice.updateMany({ data: { nextAttemptAt: new Date() } });
    await processDue();
    expect(api.adjusted[0]).toMatchObject({ adjustment_type: 'decrease', is_draft: false });
    const after = (await staff.client.orders.get({ params: { id: o.id } })).body as OrderDto;
    expect(after.einvoice?.adjustment).toBe('ISSUED');
  });

  it('no Internet: waits and goes out later; a refused invoice raises the alert and can be sent again', async () => {
    const { admin, staff, pho } = await setup();
    const api = mockSepay({ pendingChecks: 0 });
    await admin.client.einvoice.saveConfig({ body: sepayConfig() });

    api.offline = true;
    const o = paidOrder(await sell(staff.client, pho));
    expect(o.einvoice).toMatchObject({ status: 'PENDING' });
    expect(o.einvoice!.lastError).toContain('Không kết nối được SePay');
    // Cancelled before it ever left: dropped, nothing to adjust.
    const o2 = paidOrder(await sell(staff.client, pho));
    await staff.client.orders.cancel({
      params: { id: o2.id },
      body: { reason: 'Khách đổi ý', wastedItemIds: [] },
    });
    expect(
      ((await staff.client.orders.get({ params: { id: o2.id } })).body as OrderDto).einvoice?.status,
    ).toBe('CANCELLED');

    api.offline = false;
    await prisma.eInvoice.updateMany({ where: { status: 'PENDING' }, data: { nextAttemptAt: new Date() } });
    expect(await processDue()).toEqual({ done: 1, waiting: 0 });
    expect(
      ((await staff.client.orders.get({ params: { id: o.id } })).body as OrderDto).einvoice?.status,
    ).toBe('ISSUED');

    api.refuse = 'REGISTRATION_NOT_TAX_APPROVED';
    const o3 = paidOrder(await sell(staff.client, pho));
    expect(o3.einvoice).toMatchObject({ status: 'FAILED' });
    expect(o3.einvoice!.lastError).toContain('REGISTRATION_NOT_TAX_APPROVED');
    expect((await admin.client.reports.dashboard()).body).toMatchObject({ alerts: { einvoiceFailed: 1 } });

    api.refuse = null;
    const retried = await staff.client.einvoice.retry({ params: { id: o3.einvoice!.id }, body: {} });
    expect(retried.body).toMatchObject({ status: 'ISSUED' });
    expect((await admin.client.reports.dashboard()).body).toMatchObject({ alerts: { einvoiceFailed: 0 } });
  });
});
