// Minimal Telegram Bot API client over fetch: just what the backup needs (no SDK).
import { openAsBlob } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../../core/errors';

const API = 'https://api.telegram.org';
/** Bots may upload files up to 50 MB. */
export const MAX_UPLOAD = 50 * 1024 * 1024;

export const telegramError = (message: string, details?: unknown) =>
  new AppError(409, 'TELEGRAM_ERROR', message, details);

/** The bot token is no longer accepted (revoked in @BotFather, or mistyped). */
export class BadTokenError extends Error {}

/** Too many messages (bots: about 1 per second per chat, 20 per minute per group): wait `seconds`. */
export class RateLimitError extends Error {
  constructor(readonly seconds: number) {
    super(`Telegram yêu cầu chờ ${seconds} giây`);
  }
}

async function call<T>(token: string, method: string, body?: FormData | Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}/bot${token}/${method}`, {
      method: 'POST',
      ...(body instanceof FormData
        ? { body }
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) }),
    });
  } catch {
    throw telegramError('Không kết nối được Telegram — kiểm tra Internet của máy chủ');
  }
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    result?: T;
    description?: string;
    parameters?: { retry_after?: number };
  };
  if (res.status === 401 || res.status === 404) throw new BadTokenError(json.description ?? 'Unauthorized');
  if (res.status === 429) throw new RateLimitError(json.parameters?.retry_after ?? 30);
  if (!json.ok) throw telegramError(`Telegram báo lỗi: ${json.description ?? res.status}`, json);
  return json.result as T;
}

export async function getMe(token: string) {
  const me = await call<{ id: number; username: string; first_name: string }>(token, 'getMe');
  return { username: me.username, name: me.first_name };
}

export interface Chat {
  id: string;
  title: string;
  type: string;
}

/** Chats that recently wrote to the bot (private chat after "Start", or a group the bot was added to). */
export async function recentChats(token: string): Promise<Chat[]> {
  type Msg = {
    chat: {
      id: number;
      type: string;
      title?: string;
      first_name?: string;
      last_name?: string;
      username?: string;
    };
  };
  const updates = await call<{ message?: Msg; channel_post?: Msg; my_chat_member?: Msg }[]>(
    token,
    'getUpdates',
    {
      allowed_updates: ['message', 'channel_post', 'my_chat_member'],
    },
  );
  const chats = new Map<string, Chat>();
  for (const u of updates) {
    const c = (u.message ?? u.channel_post ?? u.my_chat_member)?.chat;
    if (!c) continue;
    const title =
      c.title ??
      ([c.first_name, c.last_name].filter(Boolean).join(' ') ||
        (c.username ? `@${c.username}` : String(c.id)));
    chats.set(String(c.id), { id: String(c.id), title, type: c.type });
  }
  return [...chats.values()].reverse();
}

export const sendMessage = (token: string, chatId: string, text: string) =>
  call(token, 'sendMessage', { chat_id: chatId, text });

/** A message using Telegram's HTML formatting (<b>…</b>); the caller escapes what people typed. */
export const sendHtml = (token: string, chatId: string, html: string) =>
  call(token, 'sendMessage', {
    chat_id: chatId,
    text: html,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  });

/** Send a file from disk as a document (streamed from disk by openAsBlob). */
export async function sendDocument(
  token: string,
  chatId: string,
  file: string,
  caption: string,
  fileName = path.basename(file),
) {
  const { size } = await stat(file);
  if (size > MAX_UPLOAD)
    throw telegramError(`File ${Math.round(size / 1024 / 1024)} MB vượt giới hạn 50 MB của bot Telegram`);
  const form = new FormData();
  form.set('chat_id', chatId);
  form.set('caption', caption.slice(0, 1024));
  form.set('document', await openAsBlob(file), fileName);
  const msg = await call<{ message_id: number; document?: { file_id: string } }>(token, 'sendDocument', form);
  return { messageId: msg.message_id, size, fileId: msg.document?.file_id ?? null };
}

/** Bots may download files up to 20 MB (getFile). */
export const MAX_DOWNLOAD = 20 * 1024 * 1024;

/** Download a file the bot sent earlier, by its file_id. */
export async function downloadFile(token: string, fileId: string): Promise<Buffer> {
  const f = await call<{ file_path?: string; file_size?: number }>(token, 'getFile', { file_id: fileId });
  if (!f.file_path) throw telegramError('Telegram không còn giữ file này');
  if ((f.file_size ?? 0) > MAX_DOWNLOAD)
    throw telegramError('File lớn hơn 20 MB — bot Telegram không tải về được');
  let res: Response;
  try {
    res = await fetch(`${API}/file/bot${token}/${f.file_path}`);
  } catch {
    throw telegramError('Không kết nối được Telegram — kiểm tra Internet của máy chủ');
  }
  if (!res.ok) throw telegramError(`Tải file từ Telegram lỗi ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
