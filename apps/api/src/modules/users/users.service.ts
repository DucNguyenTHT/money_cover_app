import type { Role, Station } from '@prisma/client';
import { prisma } from '../../core/db';
import { badRequest, conflict, notFound } from '../../core/errors';
import { writeAudit } from '../../core/audit';
import { hashSecret, toUserDto } from '../auth/auth.service';

interface UserInput {
  fullName: string;
  role: Role;
  station: Station | null;
  active: boolean;
}

/** Only the editable profile fields (never pass through username/password from the request body). */
const normalize = (u: UserInput): UserInput => ({
  fullName: u.fullName,
  role: u.role,
  station: u.role === 'KITCHEN' ? u.station : null,
  active: u.active,
});

export async function list() {
  const users = await prisma.user.findMany({
    orderBy: [{ active: 'desc' }, { role: 'asc' }, { username: 'asc' }],
  });
  return users.map(toUserDto);
}

export async function approvers() {
  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN', active: true, pinHash: { not: null } },
    orderBy: { fullName: 'asc' },
    select: { id: true, fullName: true },
  });
  return admins;
}

export async function create(actorId: number, input: UserInput & { username: string; password: string }) {
  if (await prisma.user.findUnique({ where: { username: input.username } })) {
    throw conflict('USERNAME_TAKEN', 'Tên đăng nhập đã tồn tại');
  }
  const data = normalize(input);
  const user = await prisma.user.create({
    data: {
      ...data,
      username: input.username,
      passwordHash: await hashSecret(input.password),
      mustChangePassword: true,
    },
  });
  await writeAudit(prisma, {
    entity: 'user',
    entityId: user.id,
    action: 'CREATE',
    after: toUserDto(user),
    userId: actorId,
  });
  return toUserDto(user);
}

/** At least one active ADMIN must always remain. */
async function assertAdminRemains(userId: number, next: UserInput) {
  const current = await prisma.user.findUnique({ where: { id: userId } });
  if (!current) throw notFound('Tài khoản');
  const losingAdmin = current.role === 'ADMIN' && current.active && (next.role !== 'ADMIN' || !next.active);
  if (!losingAdmin) return current;
  const others = await prisma.user.count({ where: { role: 'ADMIN', active: true, id: { not: userId } } });
  if (others === 0) throw badRequest('Phải còn ít nhất một tài khoản ADMIN đang hoạt động');
  return current;
}

export async function update(actorId: number, userId: number, input: UserInput) {
  const data = normalize(input);
  const before = await assertAdminRemains(userId, data);
  if (actorId === userId && (!data.active || data.role !== before.role)) {
    throw badRequest('Không thể tự khoá hoặc tự đổi vai trò của chính mình');
  }
  const user = await prisma.user.update({ where: { id: userId }, data });
  await writeAudit(prisma, {
    entity: 'user',
    entityId: userId,
    action: 'UPDATE',
    before: toUserDto(before),
    after: toUserDto(user),
    userId: actorId,
  });
  return toUserDto(user);
}

export async function resetPassword(actorId: number, userId: number, newPassword: string, reason: string) {
  if (!(await prisma.user.findUnique({ where: { id: userId } }))) throw notFound('Tài khoản');
  const user = await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashSecret(newPassword), mustChangePassword: true },
  });
  await writeAudit(prisma, {
    entity: 'user',
    entityId: userId,
    action: 'RESET_PASSWORD',
    reason,
    userId: actorId,
  });
  return toUserDto(user);
}

export async function resetPin(actorId: number, userId: number, reason: string) {
  if (!(await prisma.user.findUnique({ where: { id: userId } }))) throw notFound('Tài khoản');
  const user = await prisma.user.update({
    where: { id: userId },
    data: { pinHash: null, pinFailedCount: 0, pinLockedUntil: null },
  });
  await writeAudit(prisma, {
    entity: 'user',
    entityId: userId,
    action: 'RESET_PIN',
    reason,
    userId: actorId,
  });
  return toUserDto(user);
}
