import type { ErrorRequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { logger } from './logger';

export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 423 | 429;

/** Expected business error: becomes `{ error: { code, message, details } }` with `status`. */
export class AppError extends Error {
  constructor(
    readonly status: ErrorStatus,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
  get body() {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Bạn cần đăng nhập') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'Bạn không có quyền thực hiện thao tác này') =>
  new AppError(403, 'FORBIDDEN', message);
export const notFound = (what = 'Dữ liệu') => new AppError(404, 'NOT_FOUND', `${what} không tồn tại`);
export const conflict = (code: string, message: string, details?: unknown) =>
  new AppError(409, code, message, details);

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json(err.body);
    return;
  }
  // ts-rest request validation errors
  if (err && typeof err === 'object' && 'name' in err && err.name === 'RequestValidationError') {
    res
      .status(400)
      .json({ error: { code: 'VALIDATION', message: 'Dữ liệu gửi lên không hợp lệ', details: err } });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    const target = ([] as string[]).concat((err.meta?.target as string[] | string | undefined) ?? []);
    const field = target.includes('code') ? 'Mã' : target.includes('username') ? 'Tên đăng nhập' : 'Dữ liệu';
    res
      .status(409)
      .json({ error: { code: 'DUPLICATE', message: `${field} đã tồn tại`, details: { fields: target } } });
    return;
  }
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Lỗi hệ thống, vui lòng thử lại' } });
};
