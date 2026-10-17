import bcrypt from 'bcryptjs';
import type { User } from '@prisma/client';
import { prisma, type Db } from '../../core/db';
import { AppError, badRequest, forbidden, unauthorized } from '../../core/errors';
import { signToken } from '../../core/auth';
import { writeAudit } from '../../core/audit';
import { PIN_LOCK_MINUTES, PIN_MAX_FAILED, pinProblem } from '../../domain/auth/pin-policy';
import type { UserDto } from '../../contracts/common';

export const toUserDto = (u: User): UserDto => ({
  id: u.id,
  username: u.username,
  fullName: u.fullName,
  role: u.role,
  station: u.station,
  mustChangePassword: u.mustChangePassword,
  hasPin: u.pinHash !== null,
  active: u.active,
});

export const hashSecret = (s: string) => bcrypt.hash(s, 10);

export async function login(username: string, password: string) {
  const user = await prisma.user.findUnique({ where: { username } });
  const ok = user && user.active && (await bcrypt.compare(password, user.passwordHash));
  if (!ok) throw unauthorized('Sai tên đăng nhập hoặc mật khẩu');
  return { token: signToken(user), user: toUserDto(user) };
}

export async function me(userId: number) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return toUserDto(user);
}

async function checkPassword(userId: number, password: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await bcrypt.compare(password, user.passwordHash))) throw forbidden('Mật khẩu hiện tại không đúng');
  return user;
}

export async function changePassword(userId: number, currentPassword: string, newPassword: string) {
  await checkPassword(userId, currentPassword);
  if (currentPassword === newPassword) throw badRequest('Mật khẩu mới phải khác mật khẩu cũ');
  const user = await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashSecret(newPassword), mustChangePassword: false },
  });
  await writeAudit(prisma, { entity: 'user', entityId: userId, action: 'CHANGE_PASSWORD', userId });
  return toUserDto(user);
}

export async function setPin(userId: number, currentPassword: string, pin: string) {
  const user = await checkPassword(userId, currentPassword);
  if (user.role !== 'ADMIN') throw forbidden('Chỉ ADMIN có mã PIN duyệt');
  const problem = pinProblem(pin);
  if (problem) throw badRequest(problem);
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { pinHash: await hashSecret(pin), pinFailedCount: 0, pinLockedUntil: null },
  });
  await writeAudit(prisma, { entity: 'user', entityId: userId, action: 'SET_PIN', userId });
  return toUserDto(updated);
}

/**
 * Verify an ADMIN's approval PIN typed on a POS device. The approver picks their name, so failed
 * attempts are counted per admin; after PIN_MAX_FAILED the PIN is locked for PIN_LOCK_MINUTES.
 * Returns the approver's id.
 */
export async function verifyApproverPin(db: Db, approverId: number, pin: string): Promise<number> {
  const admin = await db.user.findUnique({ where: { id: approverId } });
  if (!admin || !admin.active || admin.role !== 'ADMIN' || !admin.pinHash) {
    throw forbidden('Người duyệt không hợp lệ hoặc chưa đặt mã PIN');
  }
  if (admin.pinLockedUntil && admin.pinLockedUntil > new Date()) {
    throw new AppError(423, 'PIN_LOCKED', 'Mã PIN đang tạm khoá do nhập sai nhiều lần, thử lại sau ít phút');
  }
  if (await bcrypt.compare(pin, admin.pinHash)) {
    if (admin.pinFailedCount > 0) {
      await db.user.update({ where: { id: admin.id }, data: { pinFailedCount: 0, pinLockedUntil: null } });
    }
    return admin.id;
  }
  const failed = admin.pinFailedCount + 1;
  const locked = failed >= PIN_MAX_FAILED;
  // Persist outside any caller transaction so a rollback can't erase the failed attempt.
  await prisma.user.update({
    where: { id: admin.id },
    data: {
      pinFailedCount: locked ? 0 : failed,
      pinLockedUntil: locked ? new Date(Date.now() + PIN_LOCK_MINUTES * 60_000) : null,
    },
  });
  throw forbidden(
    locked ? `Sai PIN ${PIN_MAX_FAILED} lần, mã PIN bị khoá ${PIN_LOCK_MINUTES} phút` : 'Mã PIN không đúng',
  );
}
