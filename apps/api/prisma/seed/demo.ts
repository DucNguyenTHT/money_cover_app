// Demo data for trying the app: a small phở shop menu with recipes, opening stock and overheads.
// Runs only when there are no dishes yet. Usage: pnpm --filter @ketoan/api db:seed:demo
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

async function main() {
  if ((await prisma.dish.count()) > 0) {
    console.log('Đã có món — bỏ qua dữ liệu demo.');
    return;
  }
  const branch = await prisma.branch.findFirstOrThrow();
  const admin = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } });

  const ing = async (
    code: string,
    name: string,
    unit: string,
    recipeUnit: string,
    recipeFactor: number,
    category: string,
    extra: object = {},
  ) => prisma.ingredient.create({ data: { code, name, unit, recipeUnit, recipeFactor, category, ...extra } });
  const beef = await ing('NL001', 'Thịt bò', 'kg', 'g', 1000, 'Thịt');
  const bone = await ing('NL002', 'Xương bò', 'kg', 'g', 1000, 'Thịt');
  const pork = await ing('NL003', 'Thịt heo nạc vai', 'kg', 'g', 1000, 'Thịt');
  const pho = await ing('NL004', 'Bánh phở', 'kg', 'g', 1000, 'Tinh bột');
  const bun = await ing('NL005', 'Bún tươi', 'kg', 'g', 1000, 'Tinh bột');
  const herbs = await ing('NL006', 'Hành, rau thơm', 'kg', 'g', 1000, 'Rau');
  const spice = await ing('NL007', 'Gia vị nước dùng', 'kg', 'g', 1000, 'Gia vị');
  const quay = await ing('NL008', 'Quẩy', 'cái', 'cái', 1, 'Món thêm');
  const tea = await ing('NL009', 'Trà khô', 'kg', 'g', 1000, 'Đồ uống');
  const orange = await ing('NL010', 'Cam tươi', 'kg', 'g', 1000, 'Đồ uống');
  const coca = await ing('NL011', 'Coca lon', 'lon', 'lon', 1, 'Đồ uống', {
    purchaseUnit: 'thùng',
    purchaseFactor: 24,
  });
  const box = await ing('BB001', 'Hộp giấy', 'cái', 'cái', 1, 'Bao bì', { kind: 'PACKAGING' });
  const bag = await ing('BB002', 'Túi + đũa', 'bộ', 'bộ', 1, 'Bao bì', { kind: 'PACKAGING' });

  // Categories created by the base seed: "Món ăn" (KITCHEN) and "Đồ uống" (BAR)
  const food =
    (await prisma.dishCategory.findFirst({ where: { station: 'KITCHEN' } })) ??
    (await prisma.dishCategory.create({ data: { name: 'Món ăn', station: 'KITCHEN', sort: 1 } }));
  const drink =
    (await prisma.dishCategory.findFirst({ where: { station: 'BAR' } })) ??
    (await prisma.dishCategory.create({ data: { name: 'Đồ uống', station: 'BAR', sort: 2 } }));
  const side = await prisma.dishCategory.create({ data: { name: 'Món thêm', station: 'KITCHEN', sort: 3 } });

  const start = '2026-09-01';
  type R = [number, number, ('ALL' | 'TAKEAWAY_APP')?];
  const dish = async (
    code: string,
    name: string,
    categoryId: number,
    store: number,
    app: number | null,
    recipe: R[],
    sort: number,
  ) => {
    const x = await prisma.dish.create({ data: { code, name, categoryId, sort } });
    await prisma.dishPrice.create({
      data: {
        dishId: x.id,
        priceType: 'STORE',
        price: store,
        effectiveFrom: d(start),
        createdById: admin.id,
      },
    });
    if (app)
      await prisma.dishPrice.create({
        data: { dishId: x.id, priceType: 'APP', price: app, effectiveFrom: d(start), createdById: admin.id },
      });
    await prisma.dishRecipe.create({
      data: {
        dishId: x.id,
        effectiveFrom: d(start),
        items: {
          create: recipe.map(([ingredientId, qty, scope]) => ({ ingredientId, qty, scope: scope ?? 'ALL' })),
        },
      },
    });
  };
  const takeaway: R[] = [
    [box.id, 1, 'TAKEAWAY_APP'],
    [bag.id, 1, 'TAKEAWAY_APP'],
  ];
  await dish(
    'PHO01',
    'Phở bò tái',
    food.id,
    55000,
    69000,
    [[beef.id, 0.12], [bone.id, 0.25], [pho.id, 0.2], [herbs.id, 0.03], [spice.id, 0.01], ...takeaway],
    1,
  );
  await dish(
    'PHO02',
    'Phở bò tái nạm',
    food.id,
    60000,
    75000,
    [[beef.id, 0.16], [bone.id, 0.25], [pho.id, 0.2], [herbs.id, 0.03], [spice.id, 0.01], ...takeaway],
    2,
  );
  await dish(
    'BUN01',
    'Bún chả',
    food.id,
    50000,
    62000,
    [[pork.id, 0.15], [bun.id, 0.2], [herbs.id, 0.05], [spice.id, 0.01], ...takeaway],
    3,
  );
  await dish(
    'BUN02',
    'Bún bò Huế',
    food.id,
    55000,
    69000,
    [[beef.id, 0.1], [bone.id, 0.25], [bun.id, 0.2], [herbs.id, 0.04], [spice.id, 0.015], ...takeaway],
    4,
  );
  await dish('THEM01', 'Quẩy (2 cái)', side.id, 10000, 12000, [[quay.id, 2]], 1);
  await dish('THEM02', 'Thêm thịt bò', side.id, 20000, 25000, [[beef.id, 0.07]], 2);
  await dish('DU01', 'Trà đá', drink.id, 5000, null, [[tea.id, 0.002]], 1);
  await dish('DU02', 'Nước cam', drink.id, 30000, 38000, [[orange.id, 0.35]], 2);
  await dish('DU03', 'Coca lon', drink.id, 15000, 20000, [[coca.id, 1]], 3);

  // Opening stock on the day before the demo month.
  const opening: [number, number, number][] = [
    [beef.id, 8, 265000],
    [bone.id, 15, 70000],
    [pork.id, 5, 140000],
    [pho.id, 12, 18000],
    [bun.id, 10, 15000],
    [herbs.id, 3, 40000],
    [spice.id, 2, 120000],
    [quay.id, 120, 2500],
    [tea.id, 1, 150000],
    [orange.id, 10, 30000],
    [coca.id, 48, 9800],
    [box.id, 300, 1800],
    [bag.id, 300, 600],
  ];
  const receipt = await prisma.receipt.create({
    data: {
      branchId: branch.id,
      kind: 'OPENING',
      date: d('2026-08-31'),
      note: 'Tồn đầu (demo)',
      createdById: admin.id,
    },
  });
  for (const [ingredientId, qty, unitPrice] of opening) {
    const item = await prisma.receiptItem.create({
      data: { receiptId: receipt.id, ingredientId, qty, unitPrice, amount: Math.round(qty * unitPrice) },
    });
    await prisma.lot.create({
      data: {
        branchId: branch.id,
        ingredientId,
        date: receipt.date,
        unitPrice,
        qtyIn: qty,
        qtyRemaining: qty,
        receiptItemId: item.id,
      },
    });
  }

  await prisma.deliveryApp.createMany({
    data: [
      { name: 'GrabFood', commissionPct: 25 },
      { name: 'ShopeeFood', commissionPct: 20 },
    ],
  });
  for (const month of [7, 8, 9]) {
    await prisma.overheadExpense.createMany({
      data: [
        { branchId: branch.id, year: 2026, month, category: 'Mặt bằng', amount: 15000000 },
        { branchId: branch.id, year: 2026, month, category: 'Lương', amount: 28000000 },
        { branchId: branch.id, year: 2026, month, category: 'Điện', amount: 3200000 },
        { branchId: branch.id, year: 2026, month, category: 'Gas', amount: 2400000 },
      ],
    });
  }
  console.log('Đã tạo dữ liệu demo: 13 nguyên liệu, 9 món, tồn đầu, 2 app giao hàng, chi phí chung T7–T9.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
