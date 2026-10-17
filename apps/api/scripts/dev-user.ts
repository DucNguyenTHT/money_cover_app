// Create / refresh a ready-to-use account on the DEV database (for local screenshots & e2e runs).
// Usage: pnpm --filter @ketoan/api exec tsx scripts/dev-user.ts <username> <password> [ADMIN|STAFF|KITCHEN] [pin]
import bcrypt from 'bcryptjs';
import { PrismaClient, type Role } from '@prisma/client';

const [username, password, role = 'ADMIN', pin] = process.argv.slice(2);
if (!username || !password) {
  console.error('Usage: tsx scripts/dev-user.ts <username> <password> [role] [pin]');
  process.exit(1);
}

const prisma = new PrismaClient();
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
