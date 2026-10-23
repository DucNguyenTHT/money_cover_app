// Create / refresh a ready-to-use account on the DEV database (for local screenshots & e2e runs).
// Usage: pnpm --filter @ketoan/api exec tsx scripts/dev-user.ts <username> <password> [ADMIN|STAFF|KITCHEN] [pin]
//        ... <username> <password> --temporary   → an existing account back to "first login" (password to change,
//                                                  no PIN), as on a fresh install (e2e onboarding).
import bcrypt from 'bcryptjs';
import { PrismaClient, type Role } from '@prisma/client';

const temporary = process.argv.includes('--temporary');
const [username, password, role = 'ADMIN', pin] = process.argv.slice(2).filter((a) => a !== '--temporary');
if (!username || !password) {
  console.error(
    'Usage: tsx scripts/dev-user.ts <username> <password> [role] [pin] | <username> <password> --temporary',
  );
  process.exit(1);
}

const prisma = new PrismaClient();
if (temporary) {
  await prisma.user.update({
    where: { username },
    data: {
      passwordHash: await bcrypt.hash(password, 10),
      mustChangePassword: true,
      pinHash: null,
      active: true,
    },
  });
  console.log(`OK: ${username} — mật khẩu tạm, đổi ở lần đăng nhập đầu`);
  await prisma.$disconnect();
  process.exit(0);
}
const data = {
  fullName: username,
  role: role as Role,
  passwordHash: await bcrypt.hash(password, 10),
  pinHash: pin ? await bcrypt.hash(pin, 10) : null,
  mustChangePassword: false,
  active: true,
  station: role === 'KITCHEN' ? ('KITCHEN' as const) : null,
};
await prisma.user.upsert({ where: { username }, update: data, create: { username, ...data } });
console.log(`OK: ${username} (${role})`);
await prisma.$disconnect();
