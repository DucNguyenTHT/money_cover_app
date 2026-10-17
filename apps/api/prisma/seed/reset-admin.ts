// Forgotten admin password: give an ADMIN account a new temporary password (must be changed at next login).
//   dev:  pnpm --filter @ketoan/api db:reset-admin [username]
//   shop: powershell -ExecutionPolicy Bypass -File scripts\reset-admin.ps1 [-User admin]
import { randomInt } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const username = process.argv[2] ?? 'admin';

function randomPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 12 }, () => alphabet[randomInt(alphabet.length)]).join('');
}

async function main() {
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || user.role !== 'ADMIN') throw new Error(`Không có tài khoản ADMIN tên "${username}"`);
  const password = randomPassword();
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(password, 10), mustChangePassword: true, active: true },
    }),
    prisma.auditLog.create({
      data: {
        entity: 'user',
        entityId: String(user.id),
        action: 'RESET_PASSWORD',
        reason: 'reset-admin script',
      },
    }),
  ]);
  console.log(`\n  Tài khoản        : ${username}`);
  console.log(`  Mật khẩu tạm thời: ${password}`);
  console.log('  (đăng nhập xong sẽ phải đổi mật khẩu; mã PIN cũ vẫn giữ nguyên)\n');
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
