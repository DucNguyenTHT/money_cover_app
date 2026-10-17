import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { commonErrors, userSchema, type RouteMeta } from './common';

const c = initContract();

const password = z.string().min(8, 'Mật khẩu tối thiểu 8 ký tự');

export const authContract = c.router(
  {
    login: {
      method: 'POST',
      path: '/api/auth/login',
      body: z.object({ username: z.string().trim().min(1), password: z.string().min(1) }),
      responses: { 200: z.object({ token: z.string(), user: userSchema }), ...commonErrors },
      metadata: { public: true } satisfies RouteMeta,
      summary: 'Đăng nhập',
    },
    me: {
      method: 'GET',
      path: '/api/auth/me',
      responses: { 200: userSchema, ...commonErrors },
      summary: 'Tài khoản đang đăng nhập',
    },
    changePassword: {
      method: 'POST',
      path: '/api/auth/change-password',
      body: z.object({ currentPassword: z.string().min(1), newPassword: password }),
      responses: { 200: userSchema, ...commonErrors },
      summary: 'Đổi mật khẩu',
    },
    setPin: {
      method: 'PUT',
      path: '/api/auth/pin',
      body: z.object({ currentPassword: z.string().min(1), pin: z.string() }),
      responses: { 200: userSchema, ...commonErrors },
      metadata: { roles: ['ADMIN'] } satisfies RouteMeta,
      summary: 'Đặt / đổi mã PIN duyệt (ADMIN)',
    },
  },
  { strictStatusCodes: true },
);
