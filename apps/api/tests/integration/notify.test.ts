import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/core/db';
import { toDbDate } from '../../src/domain/business-date';
import { flush } from '../../src/modules/notify/notify.service';
import { businessToday } from '../../src/modules/settings/settings.service';
import type { OrderDto } from '../../src/contracts/orders.contract';
import { makeUser, resetDb, startServer, stopServer } from '../helpers/harness';
import { branchId, makeIngredient } from '../helpers/factories';
import { TOKEN, mockTelegram, type SentToTelegram } from '../helpers/telegram-mock';

beforeAll(startServer);
afterAll(stopServer);
beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

const PIN = '2580';
type Client = Awaited<ReturnType<typeof makeUser>>['client'];

/** Admin + cashier, Telegram set up (backups and reports to chat 555), one dish costing 30.000 for 50.000. */
async function setup() {
  const admin = await makeUser({ username: 'chu', role: 'ADMIN', pin: PIN });
  const staff = await makeUser({ username: 'lan', role: 'STAFF' });
  const tg = mockTelegram();
  await admin.client.telegram.saveToken({ body: { botToken: TOKEN } });
  await admin.client.telegram.setChat({ body: { chatId: '555', title: 'Chủ Quán' } });
  tg.sent.length = 0;
  const c = admin.client;
  const cat = (
    await c.menu.createCategory({
      body: { name: 'Món nước', foodCostTarget: null, station: 'KITCHEN', sort: 1 },
    })
  ).body as { id: number };
  const beef = await makeIngredient({ name: 'Thịt bò' });
  await prisma.lot.create({
    data: {
      branchId: await branchId(),
      ingredientId: beef.id,
      date: toDbDate('2026-01-01'),
      unitPrice: 150000,
      qtyIn: 20,
      qtyRemaining: 20,
    },
  });
  const dish = async (code: string, price: string, grams: string) => {
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
        items: [{ ingredientId: beef.id, qty: grams, scope: 'ALL' }],
      },
    });
    return d.id;
  };
  return {
    admin,
    staff,
    tg,
    pho: await dish('PHO', '50000', '200'),
    cheap: await dish('RE', '20000', '200'),
    beef,
  };
}

async function sale(c: Client, dishId: number, qty = 1) {
  const o = (
    await c.orders.open({
      body: {
        channel: 'TAKEAWAY',
        tableId: null,
        deliveryAppId: null,
        appOrderCode: null,
        guestCount: 1,
        note: null,
        items: [{ dishId, qty }],
      },
    })
  ).body as OrderDto;
  return o;
}

const payCash = async (c: Client, o: OrderDto, extra: object = {}) => {
  const r = await c.orders.pay({
    params: { id: o.id },
    body: {
      version: o.version,
      payments: [{ method: 'CASH', amount: o.total, cashReceived: null }],
      print: false,
      ...extra,
    },
  });
  return r;
};

const texts = (sent: SentToTelegram[], chatId = '555') =>
  sent.filter((m) => m.method === 'sendMessage' && m.chatId === chatId).map((m) => m.text!);

describe('Telegram reports for the owner', () => {
  it('closing the day sends the report; turned off, nothing goes', async () => {
    const { staff, admin, tg, pho } = await setup();
    const today = await businessToday();
    for (let i = 0; i < 2; i++) await payCash(staff.client, await sale(staff.client, pho));
    const closed = await staff.client.dayClosing.close({
      params: { date: today },
      body: { countedCash: '50000', note: 'Thiếu tiền lẻ' },
    });
    expect(closed.status).toBe(200);
    expect(await flush()).toEqual({ sent: 1, error: null });
    const [report] = texts(tg.sent);
    expect(tg.sent.at(-1)!.parseMode).toBe('HTML');
    expect(report).toContain(`<b>📊 Chốt ngày ${today.split('-').reverse().join('/')}</b> · Quán test`);
    expect(report).toContain('Doanh thu thuần: <b>100.000 đ</b> · 2 đơn');
    expect(report).toContain('Lãi gộp tạm tính: 40.000 đ (40% doanh thu)');
    expect(report).toContain('Tiền mặt két: dự kiến 100.000 đ · đếm 50.000 đ · <b>thiếu 50.000 đ</b> ⚠️');
    expect(report).toContain('Ghi chú: Thiếu tiền lẻ');
    expect(report).toContain('Người chốt: LAN');

    // Sending again is idempotent; a new closing is a new report ("Chốt lại").
    expect(await flush()).toEqual({ sent: 0, error: null });
    await staff.client.dayClosing.close({
      params: { date: today },
      body: { countedCash: '100000', note: null },
    });
    await flush();
    expect(texts(tg.sent)[1]).toContain('Chốt lại ngày');
    expect(texts(tg.sent)[1]).toContain('· khớp');

    await admin.client.settings.update({ body: { settings: { notify_daily: false } } });
    await staff.client.dayClosing.close({
      params: { date: today },
      body: { countedCash: '100000', note: null },
    });
    await flush();
    expect(texts(tg.sent)).toHaveLength(2);
  });

  it('alerts: paid order cancelled, discount over the limit, sale below cost', async () => {
    const { staff, admin, tg, pho, cheap } = await setup();
    const adminId = admin.user.id;

    // Cancel of a paid order (staff, same day).
    const paid = ((await payCash(staff.client, await sale(staff.client, pho))).body as { order: OrderDto })
      .order;
    await staff.client.orders.cancel({
      params: { id: paid.id },
      body: { reason: 'Khách đổi ý', wastedItemIds: [] },
    });
    // Cancel of an open order: no alert.
    const open = await sale(staff.client, pho);
    await staff.client.orders.cancel({
      params: { id: open.id },
      body: { reason: 'Gọi nhầm món', wastedItemIds: [] },
    });

    // 50% off needs the ADMIN PIN → alert.
    const o = await sale(staff.client, pho, 2);
    const d = await staff.client.orders.discount({
      params: { id: o.id },
      body: {
        version: o.version,
        type: 'PERCENT',
        value: '50',
        reason: 'Khách quen lâu năm',
        approval: { approverId: adminId, pin: PIN },
      },
    });
    expect(d.status).toBe(200);
    // Within the limit: no alert. ADMIN giving it themselves: no alert either.
    const small = await sale(staff.client, pho);
    await staff.client.orders.discount({
      params: { id: small.id },
      body: { version: small.version, type: 'PERCENT', value: '5', reason: 'Làm tròn' },
    });
    const own = await sale(admin.client, pho);
    await admin.client.orders.discount({
      params: { id: own.id },
      body: { version: own.version, type: 'PERCENT', value: '30', reason: 'Bạn bè' },
    });

    // Below cost (20.000 for 30.000 of beef): asks for a reason, then alerts.
    const c = await sale(staff.client, cheap);
    expect((await payCash(staff.client, c)).status).toBe(409);
    expect((await payCash(staff.client, c, { belowCostReason: 'Khuyến mãi khai trương' })).status).toBe(200);

    await flush();
    const sent = texts(tg.sent);
    expect(sent).toHaveLength(3);
    expect(sent[0]).toContain(`⚠️ <b>Huỷ đơn đã thanh toán</b> ${paid.code} · 50.000 đ`);
    expect(sent[0]).toContain('Người huỷ: LAN');
    expect(sent[0]).toContain('Lý do: Khách đổi ý');
    expect(sent[1]).toContain(`⚠️ <b>Giảm giá vượt mức</b> đơn ${o.code}: 50% (50.000 đ)`);
    expect(sent[1]).toContain('Thu ngân: LAN · Duyệt: CHU');
    expect(sent[2]).toContain(
      `⚠️ <b>Bán dưới giá vốn</b> đơn ${c.code}: thu 20.000 đ, giá vốn 30.000 đ (lỗ 10.000 đ)`,
    );
    expect(sent[2]).toContain('Lý do: Khuyến mãi khai trương');

    // Turned off: nothing more is queued.
    await admin.client.settings.update({ body: { settings: { notify_alerts: false } } });
    const again = ((await payCash(staff.client, await sale(staff.client, pho))).body as { order: OrderDto })
      .order;
    await staff.client.orders.cancel({
      params: { id: again.id },
      body: { reason: 'Khách đổi ý', wastedItemIds: [] },
    });
    await flush();
    expect(texts(tg.sent)).toHaveLength(3);
  });

  it('no Internet: messages wait and go out later; reports can go to their own chat', async () => {
    const { staff, admin, pho } = await setup();
    vi.restoreAllMocks();
    mockTelegram({ offline: true });
    const paid = ((await payCash(staff.client, await sale(staff.client, pho))).body as { order: OrderDto })
      .order;
    await staff.client.orders.cancel({
      params: { id: paid.id },
      body: { reason: 'Khách đổi ý', wastedItemIds: [] },
    });
    const run = await flush();
    expect(run.sent).toBe(0);
    expect(run.error).toContain('Không kết nối được Telegram');
    expect((await admin.client.telegram.queue()).body).toMatchObject({ waiting: 1, dropped: 0 });

    vi.restoreAllMocks();
    const tg = mockTelegram();
    // Reports to a group the manager reads; backups stay in the owner's private chat.
    const set = await admin.client.telegram.setReportChat({
      body: { chatId: '-1001234', title: 'Quản lý quán' },
    });
    expect(set.body).toMatchObject({
      chatId: '555',
      reportChatId: '-1001234',
      reportChatTitle: 'Quản lý quán',
      reportReady: true,
    });
    expect(texts(tg.sent, '-1001234')[0]).toContain('báo cáo chốt ngày');
    expect(await flush()).toEqual({ sent: 1, error: null });
    expect(texts(tg.sent, '-1001234')[1]).toContain('Huỷ đơn đã thanh toán');
    expect((await admin.client.telegram.queue()).body).toMatchObject({ waiting: 0 });

    // Back to the backup chat.
    const back = await admin.client.telegram.setReportChat({ body: { chatId: null, title: null } });
    expect(back.body).toMatchObject({ reportChatId: null, reportReady: true });
  });

  it('morning digest: yesterday not closed, stock running low; ADMIN only', async () => {
    const { staff, admin, tg, pho, beef } = await setup();
    const today = await businessToday();
    const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86400_000).toISOString().slice(0, 10);
    const o = ((await payCash(staff.client, await sale(staff.client, pho, 3))).body as { order: OrderDto })
      .order;
    await prisma.order.update({ where: { id: o.id }, data: { businessDate: toDbDate(yesterday) } });
    await prisma.ingredient.update({ where: { id: beef.id }, data: { minStock: 50 } });

    expect((await staff.client.telegram.sendDigest({ body: {} })).status).toBe(403);
    const r = await admin.client.telegram.sendDigest({ body: {} });
    expect(r.status).toBe(200);
    const text = (r.body as { text: string }).text;
    const short = yesterday.slice(8, 10) + '/' + yesterday.slice(5, 7);
    expect(text).toContain(`Hôm qua (${short}): doanh thu thuần 150.000 đ · 1 đơn`);
    expect(text).toContain(`• ⚠️ Ngày ${short} chưa chốt ngày (đếm tiền két)`);
    expect(text).toContain('• Sắp hết hàng (1): Thịt bò');
    expect(texts(tg.sent)).toEqual([text]);
  });
});
