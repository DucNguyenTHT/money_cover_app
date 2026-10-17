// Initial data: the branch, an ADMIN account, default settings and a starting floor plan.
// Safe to run more than once: existing rows are kept.
import { randomInt } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

import { DEFAULT_SETTINGS } from '../../src/modules/settings/defaults';

function randomPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 12 }, () => alphabet[randomInt(alphabet.length)]).join('');
}

async function main() {
  await prisma.branch.upsert({
    where: { code: 'CS01' },
    update: {},
    create: { code: 'CS01', name: '[TÊN QUÁN]', address: '[ĐỊA CHỈ]', phone: '' },
  });

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.setting.upsert({
      where: { key },
      update: {},
      create: { key, value: value as Prisma.InputJsonValue },
    });
  }

  if (!(await prisma.user.findUnique({ where: { username: 'admin' } }))) {
    const password = randomPassword();
    await prisma.user.create({
      data: {
        username: 'admin',
        fullName: 'Quản lý',
        role: 'ADMIN',
        passwordHash: await bcrypt.hash(password, 10),
        mustChangePassword: true,
      },
    });
    console.log('\n  Tài khoản quản trị: admin');
    console.log(`  Mật khẩu tạm thời : ${password}`);
    console.log('  (bắt buộc đổi mật khẩu và đặt mã PIN ở lần đăng nhập đầu tiên)\n');
  }

  if ((await prisma.dishCategory.count()) === 0) {
    await prisma.dishCategory.createMany({
      data: [
        { name: 'Món ăn', station: 'KITCHEN', sort: 1, foodCostTarget: 35 },
        { name: 'Đồ uống', station: 'BAR', sort: 2, foodCostTarget: 25 },
      ],
    });
  }

  if ((await prisma.area.count()) === 0) {
    const area = await prisma.area.create({ data: { name: 'Tầng 1', sort: 1 } });
    await prisma.diningTable.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({
        areaId: area.id,
        name: `Bàn ${String(i + 1).padStart(2, '0')}`,
        seats: 4,
        sort: i + 1,
      })),
    });
  }
}

main()
  .then(() => console.log('Seed xong.'))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
