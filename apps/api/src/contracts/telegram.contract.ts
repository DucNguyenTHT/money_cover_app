import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { commonErrors, type RouteMeta } from './common';

const c = initContract();
const admin = { roles: ['ADMIN'] } satisfies RouteMeta;

export const telegramStatus = z.object({
  /** Bot set (token entered); the token itself is never sent back. */
  botUsername: z.string().nullable(),
  chatId: z.string().nullable(),
  chatTitle: z.string().nullable(),
  /** Bot and chat chosen: backups can be sent. */
  ready: z.boolean(),
});
export type TelegramStatus = z.infer<typeof telegramStatus>;

export const telegramChat = z.object({ id: z.string(), title: z.string(), type: z.string() });
export type TelegramChat = z.infer<typeof telegramChat>;

export const telegramContract = c.router(
  {
    status: {
      method: 'GET',
      path: '/api/telegram',
      metadata: admin,
      responses: { 200: telegramStatus, ...commonErrors },
    },
    saveToken: {
      method: 'PUT',
      path: '/api/telegram/token',
      body: z.object({
        botToken: z
          .string()
          .trim()
          .regex(/^\d{5,}:[\w-]{30,}$/, 'Mã bot có dạng 123456789:AAH… (lấy từ @BotFather)'),
      }),
      metadata: admin,
      responses: { 200: telegramStatus, ...commonErrors },
      summary: 'Lưu mã bot Telegram (kiểm tra với Telegram trước khi lưu)',
    },
    chats: {
      method: 'POST',
      path: '/api/telegram/chats',
      body: z.object({}),
      metadata: admin,
      responses: { 200: z.array(telegramChat), ...commonErrors },
      summary: 'Các cuộc trò chuyện vừa nhắn cho bot',
    },
    setChat: {
      method: 'PUT',
      path: '/api/telegram/chat',
      body: z.object({ chatId: z.string().regex(/^-?\d+$/), title: z.string().trim().min(1).max(200) }),
      metadata: admin,
      responses: { 200: telegramStatus, ...commonErrors },
      summary: 'Chọn nơi nhận bản sao lưu (gửi một tin thử)',
    },
    clear: {
      method: 'DELETE',
      path: '/api/telegram',
      body: z.object({}),
      metadata: admin,
      responses: { 200: telegramStatus, ...commonErrors },
    },
  },
  { strictStatusCodes: true },
);
