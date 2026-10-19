// When the nightly database backup is due, and what the owner should be warned about.
// Shop time is Asia/Ho_Chi_Minh (UTC+7, no daylight saving).

const SHOP_OFFSET_MS = 7 * 3600_000;
const HOUR = 3600_000;

/** Shop-local calendar date "YYYY-MM-DD" and hour of an instant. */
export function shopClock(at: Date) {
  const local = new Date(at.getTime() + SHOP_OFFSET_MS);
  return { date: local.toISOString().slice(0, 10), hour: local.getUTCHours() };
}

/** The most recent instant the backup was scheduled at (today at `hour`, or yesterday if not reached yet). */
export function lastSlot(now: Date, hour: number): Date {
  const { date } = shopClock(now);
  const today = Date.parse(`${date}T00:00:00Z`) - SHOP_OFFSET_MS + hour * HOUR;
  return new Date(today <= now.getTime() ? today : today - 24 * HOUR);
}

/** The next scheduled instant after `now`. */
export const nextSlot = (now: Date, hour: number) => new Date(lastSlot(now, hour).getTime() + 24 * HOUR);

/**
 * Due when no backup succeeded since the last scheduled time. A failed attempt is retried at most once an hour
 * (and right away after a restart, since the machine may have been off at the scheduled time).
 */
export function backupDue(args: {
  now: Date;
  hour: number;
  lastOkAt: string | null;
  lastAttemptAt: string | null;
}): boolean {
  const slot = lastSlot(args.now, args.hour).getTime();
  if (args.lastOkAt && Date.parse(args.lastOkAt) >= slot) return false;
  if (args.lastAttemptAt && args.now.getTime() - Date.parse(args.lastAttemptAt) < HOUR) return false;
  return true;
}

export type BackupIssue = 'NEVER' | 'FAILED' | 'STALE' | 'DRIVE_FAILED';

/** Older than this without a good backup = warn (one missed night is tolerated). */
export const STALE_AFTER_MS = 48 * HOUR;

export function backupIssue(args: {
  now: Date;
  last: { ok: boolean; drive: { ok: boolean } | null } | null;
  lastOkAt: string | null;
}): BackupIssue | null {
  if (args.last && !args.last.ok) return 'FAILED';
  if (!args.lastOkAt) return 'NEVER';
  if (args.now.getTime() - Date.parse(args.lastOkAt) > STALE_AFTER_MS) return 'STALE';
  if (args.last?.drive && !args.last.drive.ok) return 'DRIVE_FAILED';
  return null;
}
