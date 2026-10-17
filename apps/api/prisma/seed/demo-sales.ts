// Demo sales history (needs `db:seed:demo` first): random orders from 1 Sept to yesterday, weekly purchases,
// day closings, a September stocktake and October overheads — so reports and charts have something to show.
// Orders go through the real services (prices, recipes, FIFO), then get moved to their day.
// Usage: pnpm --filter @ketoan/api db:seed:demo-sales
import { prisma } from '../../src/core/db';
import type { AuthUser } from '../../src/core/auth';
import { toDbDate, fromDbDate } from '../../src/domain/business-date';
import { businessToday } from '../../src/modules/settings/settings.service';
import * as orders from '../../src/modules/orders/orders.service';
import * as inventory from '../../src/modules/inventory/inventory.service';
import * as stocktake from '../../src/modules/stocktake/stocktake.service';
import * as dayClosing from '../../src/modules/orders/day-closing.service';

let seed = 20260901;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]!;
const addDays = (iso: string, n: number) =>
  fromDbDate(new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400_000));

async function main() {
  if ((await prisma.order.count({ where: { businessDate: { lt: toDbDate('2026-10-01') } } })) > 0) {
    console.log('Đã có đơn trước tháng 10 — bỏ qua.');
    return;
  }
  const admin = await prisma.user.findFirstOrThrow({
    where: { role: 'ADMIN', active: true },
    orderBy: { id: 'asc' },
  });
  const user: AuthUser = { id: admin.id, role: 'ADMIN', station: null, fullName: admin.fullName };
  const dishes = await prisma.dish.findMany({ include: { category: true } });
  if (!dishes.length) throw new Error('Chạy db:seed:demo trước');
  const mains = dishes.filter((d) => d.category.name === 'Món ăn');
  const drinks = dishes.filter((d) => d.category.station === 'BAR');
  const sides = dishes.filter((d) => d.category.name === 'Món thêm');
  const tables = await prisma.diningTable.findMany({ where: { active: true } });
  const apps = await prisma.deliveryApp.findMany();
  const ings = await prisma.ingredient.findMany();
  const today = await businessToday();

  // Weekly purchases (Mondays) with slowly rising beef prices.
  const buy: Record<string, [number, number]> = {
    NL001: [6, 265000],
    NL002: [10, 70000],
    NL003: [4, 140000],
    NL004: [10, 18000],
    NL005: [8, 15000],
    NL006: [2, 40000],
    NL007: [1, 120000],
    NL008: [80, 2500],
    NL009: [0.5, 150000],
    NL010: [6, 30000],
    NL011: [48, 9800],
    BB001: [120, 1800],
    BB002: [120, 600],
  };
  let day = '2026-09-01';
  let week = 0;
  while (day < today) {
    // Every 3 days: buy what the last 3 days used (+15%), or a starter quantity the first time.
    if ((Date.parse(day) - Date.parse('2026-09-01')) % (3 * 86400_000) === 0) {
      week += 1;
      const used = await prisma.issueItem.groupBy({
        by: ['ingredientId'],
        where: {
          issue: { reason: 'SALE_USE', date: { gte: toDbDate(addDays(day, -3)), lt: toDbDate(day) } },
        },
        _sum: { qty: true },
      });
      await inventory.createReceipt(admin.id, {
        kind: 'PURCHASE',
        date: day,
        supplier: pick(['Chợ Bình Điền', 'Mối thịt anh Tư', 'Đại lý nước giải khát']),
        note: 'Demo',
        items: ings.map((i) => {
          const [q, p] = buy[i.code] ?? [1, 10000];
          const need = Number(used.find((u) => u.ingredientId === i.id)?._sum.qty ?? 0) * 1.15;
          const qty = Math.max(q, Math.ceil(need * 10) / 10);
          // Beef gets a little dearer every purchase so price alerts have something to show.
          const price = i.code === 'NL001' ? p + week * 1500 : p;
          return {
            ingredientId: i.id,
            qty: String(qty),
            unitPrice: String(price),
            unitMode: 'STOCK' as const,
          };
        }),
      });
    }

    const count = 10 + Math.floor(rnd() * 14) + (new Date(`${day}T00:00:00Z`).getUTCDay() % 6 === 0 ? 8 : 0);
    for (let k = 0; k < count; k++) {
      const r = rnd();
      const channel = r < 0.6 ? 'DINE_IN' : r < 0.82 ? 'TAKEAWAY' : 'APP';
      const items = [{ dishId: pick(mains).id, qty: 1 + Math.floor(rnd() * 3) }];
      if (rnd() < 0.7) items.push({ dishId: pick(drinks).id, qty: 1 + Math.floor(rnd() * 3) });
      if (rnd() < 0.3) items.push({ dishId: pick(sides).id, qty: 1 });
      const o = await orders.open(user, {
        channel,
        tableId: channel === 'DINE_IN' ? pick(tables).id : null,
        deliveryAppId: channel === 'APP' ? pick(apps).id : null,
        appOrderCode: channel === 'APP' ? String(1000 + Math.floor(rnd() * 9000)) : null,
        guestCount: 1 + Math.floor(rnd() * 3),
        note: null,
        items,
      });
      let cur = o;
      if (rnd() < 0.08)
        cur = await orders.discount(user, o.id, {
          version: o.version,
          type: 'PERCENT',
          value: '10',
          reason: 'Khách quen',
        });
      if (rnd() < 0.03) {
        await orders.cancel(user, o.id, { reason: 'Khách bỏ về (demo)', wastedItemIds: [] });
      } else {
        await orders.pay(user, o.id, {
          version: cur.version,
          print: false,
          // The demo menu has dishes priced below cost on purpose (to show loss alerts).
          belowCostReason: 'Món đang lỗ theo định mức (demo)',
          payments: [
            { method: channel === 'APP' ? 'APP' : rnd() < 0.55 ? 'CASH' : 'TRANSFER', amount: cur.total },
          ],
        });
      }
      // Move to its day, at a plausible hour (11h–14h or 17h–21h shop time).
      const hour = rnd() < 0.5 ? 11 + Math.floor(rnd() * 3) : 17 + Math.floor(rnd() * 4);
      const at = new Date(
        `${day}T${String(hour).padStart(2, '0')}:${String(Math.floor(rnd() * 60)).padStart(2, '0')}:00+07:00`,
      );
      const code = `${day.slice(2, 4)}${day.slice(5, 7)}${day.slice(8, 10)}-${String(k + 1).padStart(3, '0')}`;
      await prisma.order.update({
        where: { id: o.id },
        data: { code, businessDate: toDbDate(day), openedAt: at, paidAt: at },
      });
      await prisma.issue.updateMany({ where: { orderId: o.id }, data: { date: toDbDate(day) } });
      // History: everything was cooked and served long ago (keeps the kitchen screen empty).
      await prisma.orderItem.updateMany({
        where: { orderId: o.id, kitchenStatus: { in: ['NEW', 'SENT', 'DONE'] } },
        data: { kitchenStatus: 'SERVED', sentAt: at, doneAt: at, servedAt: at },
      });
    }
    const p = await dayClosing.preview(day);
    const off = rnd() < 0.2 ? -Math.round(rnd() * 20) * 1000 : 0;
    await dayClosing.close(user, day, String(Number(p.expectedCash) + off), off ? 'Thiếu tiền lẻ' : null);
    if (day === '2026-09-30') {
      const st = await stocktake.create(user, day, 'Kiểm kê cuối tháng 9 (demo)');
      await stocktake.update(user, st.id, {
        note: st.note,
        items: st.items.map((i) => {
          const book = Number(i.bookQty);
          if (book <= 0) return { ingredientId: i.ingredientId, actualQty: null };
          const factor = i.code === 'NL001' ? 0.94 : i.code === 'NL006' ? 0.85 : 0.98 + rnd() * 0.03;
          return {
            ingredientId: i.ingredientId,
            actualQty: String(Math.max(0, Math.round(book * factor * 1000) / 1000)),
          };
        }),
      });
      await stocktake.complete(user, st.id);
    }
    day = addDays(day, 1);
  }
  await prisma.overheadExpense.createMany({
    data: [
      {
        branchId: (await prisma.branch.findFirstOrThrow()).id,
        year: 2026,
        month: 10,
        category: 'Mặt bằng',
        amount: 15000000,
      },
      {
        branchId: (await prisma.branch.findFirstOrThrow()).id,
        year: 2026,
        month: 10,
        category: 'Lương',
        amount: 28000000,
      },
    ],
  });
  console.log(`Đã tạo đơn demo từ 01/09/2026 đến ${addDays(today, -1)}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
