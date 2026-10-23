// Messages to the owner on Telegram (day-closing report, morning digest, alerts). A message is queued in
// telegram_messages — inside the caller's transaction, so a change that rolls back sends nothing — and a worker
// sends the queue. Without Internet the messages wait and are retried for a day, then dropped.
import type { NotifyKind } from '@prisma/client';
import { env } from '../../config/env';
import { prisma, type Db } from '../../core/db';
import { AppError } from '../../core/errors';
import { logger } from '../../core/logger';
import type { Settings } from '../../contracts/settings.contract';
import { shopClock } from '../../domain/backup/schedule';
import { getSettings } from '../settings/settings.service';
import * as telegram from '../telegram/telegram.service';
import { RateLimitError } from '../telegram/telegram';

/** Not sent within a day: no longer worth sending. */
const KEEP_MS = 24 * 3600_000;
/** Telegram refused the message itself this many times: skip it (the next ones still go). */
const MAX_ATTEMPTS = 5;
/** Telegram allows about one message a second per chat. */
const PAUSE_MS = env.NODE_ENV === 'test' ? 0 : 1100;

const ENABLED: Record<NotifyKind, keyof Settings> = {
  DAILY: 'notify_daily',
  MORNING: 'notify_morning',
  ALERT: 'notify_alerts',
};

/**
 * Queue a message when Telegram is set up and this kind is turned on (no-op otherwise). `dedupeKey`: a message
 * with the same key is queued only once. Use the caller's transaction as `db`.
 */
export async function enqueue(db: Db, kind: NotifyKind, text: string, dedupeKey?: string): Promise<boolean> {
  const s = await getSettings(db);
  if (!s[ENABLED[kind]]) return false;
  if (!(await telegram.reportChat())) return false;
  const r = await db.telegramMessage.createMany({
    data: [{ kind, text, dedupeKey: dedupeKey ?? null }],
    skipDuplicates: true,
  });
  if (r.count) kick();
  return r.count > 0;
}

let timer: NodeJS.Timeout | null = null;

/** Send the queue soon (after the caller's transaction committed). Tests call flush() themselves. */
export function kick(delayMs = 1500) {
  if (env.NODE_ENV === 'test' || timer) return;
  timer = setTimeout(() => {
    timer = null;
    void flush().catch((e) => logger.error(e, 'Gửi tin Telegram lỗi'));
  }, delayMs);
  timer.unref();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waitingWhere = () => ({
  sentAt: null,
  createdAt: { gte: new Date(Date.now() - KEEP_MS) },
  attempts: { lt: MAX_ATTEMPTS },
});

/** Telegram looked at the message and refused it (bad formatting…): retrying the same text will not help soon. */
const refusedByTelegram = (e: unknown) => e instanceof AppError && e.code === 'TELEGRAM_ERROR' && !!e.details;

async function sendWaiting(): Promise<{ sent: number; error: string | null }> {
  let sent = 0;
  for (;;) {
    const batch = await prisma.telegramMessage.findMany({
      where: waitingWhere(),
      orderBy: { id: 'asc' },
      take: 20,
    });
    if (!batch.length) return { sent, error: null };
    for (const m of batch) {
      try {
        try {
          await telegram.sendReport(m.text);
        } catch (e) {
          if (!(e instanceof RateLimitError)) throw e;
          await sleep((e.seconds + 1) * 1000);
          await telegram.sendReport(m.text);
        }
      } catch (e) {
        const message = (e as Error).message;
        await prisma.telegramMessage.update({
          where: { id: m.id },
          data: { lastError: message, ...(refusedByTelegram(e) ? { attempts: { increment: 1 } } : {}) },
        });
        // No Internet / bot removed: stop here, the next run starts again with this message.
        if (!refusedByTelegram(e)) return { sent, error: message };
        continue;
      }
      await prisma.telegramMessage.update({
        where: { id: m.id },
        data: { sentAt: new Date(), attempts: { increment: 1 }, lastError: null },
      });
      sent++;
      if (PAUSE_MS) await sleep(PAUSE_MS);
    }
  }
}

let flushing: Promise<{ sent: number; error: string | null }> | null = null;

/** Send what is waiting, oldest first (one run at a time). */
export function flush() {
  flushing ??= sendWaiting().finally(() => {
    flushing = null;
  });
  return flushing;
}

export async function queueStatus() {
  const since = new Date(Date.now() - 7 * 24 * 3600_000);
  const [waiting, dropped, lastFailed, lastSent] = await Promise.all([
    prisma.telegramMessage.count({ where: waitingWhere() }),
    prisma.telegramMessage.count({
      where: {
        sentAt: null,
        createdAt: { gte: since },
        OR: [{ createdAt: { lt: new Date(Date.now() - KEEP_MS) } }, { attempts: { gte: MAX_ATTEMPTS } }],
      },
    }),
    prisma.telegramMessage.findFirst({
      where: { sentAt: null, lastError: { not: null }, createdAt: { gte: since } },
      orderBy: { id: 'desc' },
    }),
    prisma.telegramMessage.findFirst({ where: { sentAt: { not: null } }, orderBy: { sentAt: 'desc' } }),
  ]);
  return {
    waiting,
    dropped,
    lastError: lastFailed?.lastError ?? null,
    lastSentAt: lastSent?.sentAt?.toISOString() ?? null,
  };
}

/** The morning digest key of a calendar day (one digest per day). */
export const morningKey = (date: string) => `MORNING:${date}`;

/**
 * Every minute: queue the morning digest once its hour has come (also later in the day when the server was off
 * in the morning), then send the queue.
 */
export function startScheduler(buildMorning: (now: Date) => Promise<string>) {
  const tick = async () => {
    try {
      const s = await getSettings();
      const now = new Date();
      const { date, hour } = shopClock(now);
      if (s.notify_morning && hour >= s.notify_morning_hour && (await telegram.reportChat())) {
        const done = await prisma.telegramMessage.findUnique({ where: { dedupeKey: morningKey(date) } });
        if (!done) await enqueue(prisma, 'MORNING', await buildMorning(now), morningKey(date));
      }
      await flush();
    } catch (e) {
      logger.error(e, 'Báo cáo Telegram lỗi');
    }
  };
  setTimeout(tick, 30_000).unref();
  setInterval(tick, 60_000).unref();
}
