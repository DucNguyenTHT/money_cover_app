// Telegram bot as a backup destination: the ADMIN enters the bot token (sealed) and picks the chat the
// backups go to. Stored in `settings` under TELEGRAM_KEY (not part of the public settings schema).
import type { Prisma } from '@prisma/client';
import { prisma } from '../../core/db';
import { writeAudit } from '../../core/audit';
import { badRequest, conflict } from '../../core/errors';
import { open, seal } from '../../core/secret-box';
import type { TelegramChat, TelegramStatus } from '../../contracts/telegram.contract';
import * as tg from './telegram';

const TELEGRAM_KEY = 'telegram';
const SEAL = 'telegram-bot-token';

interface Stored {
  botToken: string; // sealed
  botUsername: string;
  chatId: string | null;
  chatTitle: string | null;
}

async function load(): Promise<Stored | null> {
  const row = await prisma.setting.findUnique({ where: { key: TELEGRAM_KEY } });
  return (row?.value as Stored | undefined) ?? null;
}

async function save(v: Stored | null) {
  if (!v) return void (await prisma.setting.deleteMany({ where: { key: TELEGRAM_KEY } }));
  const value = v as unknown as Prisma.InputJsonValue;
  await prisma.setting.upsert({
    where: { key: TELEGRAM_KEY },
    update: { value },
    create: { key: TELEGRAM_KEY, value },
  });
}

/** Bot token or a clear "enter it again" error. */
async function token(s: Stored) {
  const t = open(s.botToken, SEAL);
  if (!t) throw conflict('TELEGRAM_BAD_TOKEN', 'Mã bot Telegram không đọc được — hãy nhập lại');
  return t;
}

const badToken = () =>
  conflict(
    'TELEGRAM_BAD_TOKEN',
    'Telegram không nhận mã bot này (sai hoặc đã bị thu hồi trong @BotFather) — hãy nhập lại',
  );

export async function status(): Promise<TelegramStatus> {
  const s = await load();
  return {
    botUsername: s?.botUsername ?? null,
    chatId: s?.chatId ?? null,
    chatTitle: s?.chatTitle ?? null,
    ready: !!s?.chatId,
  };
}

export async function saveToken(userId: number, botToken: string) {
  let me: Awaited<ReturnType<typeof tg.getMe>>;
  try {
    me = await tg.getMe(botToken);
  } catch (e) {
    if (e instanceof tg.BadTokenError)
      throw badRequest('Telegram không nhận mã bot này — kiểm tra lại mã từ @BotFather');
    throw e;
  }
  const old = await load();
  // Same bot: keep the chosen chat. Another bot: it is not in that chat, choose again.
  const sameBot = old?.botUsername === me.username;
  await save({
    botToken: seal(botToken, SEAL),
    botUsername: me.username,
    chatId: sameBot ? old!.chatId : null,
    chatTitle: sameBot ? old!.chatTitle : null,
  });
  await writeAudit(prisma, {
    entity: 'telegram',
    entityId: 'bot',
    action: 'SET_BOT',
    before: old ? { bot: old.botUsername } : null,
    after: { bot: me.username },
    userId,
  });
  return status();
}

export async function chats(): Promise<TelegramChat[]> {
  const s = await load();
  if (!s) throw conflict('TELEGRAM_NOT_SET', 'Chưa nhập mã bot Telegram');
  try {
    return await tg.recentChats(await token(s));
  } catch (e) {
    if (e instanceof tg.BadTokenError) throw badToken();
    throw e;
  }
}

/** Choose where backups go; a test message confirms the bot can write there. */
export async function setChat(userId: number, chatId: string, title: string) {
  const s = await load();
  if (!s) throw conflict('TELEGRAM_NOT_SET', 'Chưa nhập mã bot Telegram');
  try {
    await tg.sendMessage(
      await token(s),
      chatId,
      '✅ Kế toán quán: bản sao lưu dữ liệu hằng đêm sẽ được gửi vào đây. Đừng xoá các file này.',
    );
  } catch (e) {
    if (e instanceof tg.BadTokenError) throw badToken();
    throw e;
  }
  await save({ ...s, chatId, chatTitle: title });
  await writeAudit(prisma, {
    entity: 'telegram',
    entityId: 'chat',
    action: 'SET_CHAT',
    after: { chatId, title },
    userId,
  });
  return status();
}

export async function clear(userId: number) {
  const s = await load();
  if (s) {
    await save(null);
    await writeAudit(prisma, {
      entity: 'telegram',
      entityId: 'bot',
      action: 'CLEAR',
      before: { bot: s.botUsername, chat: s.chatTitle },
      userId,
    });
  }
  return status();
}

/** True when backups can be sent (bot + chat chosen). */
export const isReady = async () => !!(await load())?.chatId;

/** Used by the backup job. */
export async function sendBackup(file: string, caption: string) {
  const s = await load();
  if (!s?.chatId) throw conflict('TELEGRAM_NOT_SET', 'Chưa chọn cuộc trò chuyện Telegram');
  try {
    return await tg.sendDocument(await token(s), s.chatId, file, caption);
  } catch (e) {
    if (e instanceof tg.BadTokenError) throw badToken();
    throw e;
  }
}
