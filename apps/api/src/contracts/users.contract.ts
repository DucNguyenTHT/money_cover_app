import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { commonErrors, reason, roleSchema, stationSchema, userSchema, type RouteMeta } from './common';

const c = initContract();
const admin = { roles: ['ADMIN'] } satisfies RouteMeta;

const password = z.string().min(8, 'Mật khẩu tối thiểu 8 ký tự');
const id = z.object({ id: z.coerce.number().int() });

export const userInput = z
  .object({
    fullName: z.string().trim().min(1, 'Nhập họ tên'),
    role: roleSchema,
    station: stationSchema.nullable(),
    active: z.boolean(),
  })
  .refine((u) => u.role !== 'KITCHEN' || u.station !== null, {
    message: 'Tài khoản bếp phải chọn trạm (Bếp hoặc Bar)',
    path: ['station'],
  });

export const usersContract = c.router(
  {
    list: {
      method: 'GET',
      path: '/api/users',
      responses: { 200: z.array(userSchema), ...commonErrors },
      metadata: admin,
    },
    create: {
      method: 'POST',
      path: '/api/users',
      body: z.intersection(
        userInput,
        z.object({
          username: z
            .string()
            .trim()
            .regex(/^[a-z0-9._-]{3,30}$/, 'Tên đăng nhập 3–30 ký tự: a-z, 0-9, . _ -'),
          password,
        }),
      ),
      responses: { 201: userSchema, ...commonErrors },
      metadata: admin,
      summary: 'Tạo tài khoản (bắt đổi mật khẩu ở lần đăng nhập đầu)',
    },
    update: {
      method: 'PUT',
      path: '/api/users/:id',
      pathParams: id,
      body: userInput,
      responses: { 200: userSchema, ...commonErrors },
      metadata: admin,
    },
    resetPassword: {
      method: 'POST',
      path: '/api/users/:id/reset-password',
      pathParams: id,
      body: z.object({ newPassword: password, reason }),
      responses: { 200: userSchema, ...commonErrors },
      metadata: admin,
    },
    resetPin: {
      method: 'POST',
      path: '/api/users/:id/reset-pin',
      pathParams: id,
      body: z.object({ reason }),
      responses: { 200: userSchema, ...commonErrors },
      metadata: admin,
    },
    approvers: {
      method: 'GET',
      path: '/api/users/approvers',
      responses: { 200: z.array(z.object({ id: z.number(), fullName: z.string() })), ...commonErrors },
      summary: 'ADMIN có mã PIN — dùng cho hộp thoại duyệt trên POS',
    },
  },
  { strictStatusCodes: true },
);
