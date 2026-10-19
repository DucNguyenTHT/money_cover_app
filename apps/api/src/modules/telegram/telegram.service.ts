// Telegram bot as a backup destination: the ADMIN enters the bot token (sealed) and picks the chat the
// backups go to. Stored in `settings` under TELEGRAM_KEY (not part of the public settings schema).
import type { Prisma } from '@prisma/client';
import { prisma } from '../../core/db';
import { writeAudit } from '../../core/audit';
import { badRequest, conflict } from '../../core/errors';
import { open, seal } from '../../core/secret-box';
import type { TelegramChat, TelegramStatus } from '../../contracts/telegram.contract';
import { storedPath } from '../../core/storage';
import { DOCUMENT_KIND_LABELS } from '../../contracts/documents.contract';
import { fromDbDate } from '../../domain/business-date';
import type { DocumentKind } from '../../domain/enums';
import * as tg from './telegram';

const TELEGRAM_KEY = 'telegram';
const SEAL = 'telegram-bot-token';

interface Stored {
  botToken: string; // sealed
  botUsername: string;
  chatId: string | null;
  chatTitle: string | null;
  /** Last document_files.id already sent to this chat (files are sent in id order). */
  docsCursor?: number;
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
  // A new chat gets every invoice file again, from the first one.
  await save({ ...s, chatId, chatTitle: title, docsCursor: s.chatId === chatId ? s.docsCursor : 0 });
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

// ---- invoice files (Chứng từ): each new file is sent once, in upload order, with a searchable caption.

const money = (v: { toString(): string }) =>
  `${Number(v.toString()).toLocaleString('vi-VN', { maximumFractionDigits: 0 })} đ`;

function caption(f: {
  name: string;
  document: {
    kind: DocumentKind;
    date: Date;
    partner: string | null;
    number: string | null;
    amount: Prisma.Decimal | null;
  };
}) {
  const d = f.document;
  return [
    `📄 ${fromDbDate(d.date).split('-').reverse().join('/')}`,
    DOCUMENT_KIND_LABELS[d.kind],
    d.partner,
    d.number ? `HĐ ${d.number}` : null,
    d.amount ? money(d.amount) : null,
  ]
    .filter(Boolean)
    .join(' · ')
    .concat(`\n${f.name}`);
}

export interface DocumentsRun {
  sent: number;
  /** Files still waiting (beyond this run's limit, or after a failure). */
  pending: number;
  error: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Send invoice files not sent yet to the chosen chat, oldest first, at most `limit` per run and `pauseMs` apart
 * (Telegram allows about 20 messages a minute in a group). Stops at the first failure; the next run resumes there.
 */
export async function sendDocuments(limit: number, pauseMs: number): Promise<DocumentsRun | null> {
  const s = await load();
  if (!s?.chatId) return null;
  const chatId = s.chatId;
  let cursor = s.docsCursor ?? 0;
  const live = { deletedAt: null, document: { deletedAt: null } } as const;
  const files = await prisma.documentFile.findMany({
    where: { id: { gt: cursor }, ...live },
    orderBy: { id: 'asc' },
    take: limit,
    include: { document: true },
  });
  let sent = 0;
  let error: string | null = null;
  const t = await token(s);
  for (const f of files) {
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          await tg.sendDocument(t, chatId, storedPath(f.path), caption(f), f.name);
          break;
        } catch (e) {
          if (!(e instanceof tg.RateLimitError) || attempt > 0) throw e;
          await sleep((e.seconds + 1) * 1000);
        }
      }
      sent++;
    } catch (e) {
      // A file missing on disk can never be sent: skip it rather than block every later file.
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        error = e instanceof tg.BadTokenError ? badToken().message : (e as Error).message;
        break;
      }
    }
    cursor = f.id;
    // Re-read: the chat may have been changed meanwhile, then this cursor no longer applies.
    const now = await load();
    if (now?.chatId !== chatId) break;
    await save({ ...now, docsCursor: cursor });
    if (pauseMs) await sleep(pauseMs);
  }
  const pending = await prisma.documentFile.count({ where: { id: { gt: cursor }, ...live } });
  return { sent, pending, error };
}
