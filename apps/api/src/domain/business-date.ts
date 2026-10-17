// Business date = the "trading day" an instant belongs to.
// Vietnam has a fixed UTC+7 offset (no DST), so a constant offset is exact.

export const VN_OFFSET_MINUTES = 7 * 60;

/** Parse "HH:mm" into minutes after midnight. */
export function parseDayStart(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) throw new Error(`Invalid business_day_start: ${hhmm}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error(`Invalid business_day_start: ${hhmm}`);
  return h * 60 + min;
}

/** "YYYY-MM-DD" business date for an instant, given the day-start time (e.g. "04:00"). */
export function businessDateOf(instant: Date, dayStart = '00:00', offsetMinutes = VN_OFFSET_MINUTES): string {
  const shifted = new Date(instant.getTime() + (offsetMinutes - parseDayStart(dayStart)) * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/** "YYYY-MM" of a "YYYY-MM-DD" date. */
export const monthOf = (isoDate: string): string => isoDate.slice(0, 7);

/** Convert "YYYY-MM-DD" to a Date at UTC midnight (how Postgres DATE columns are read/written by Prisma). */
export const toDbDate = (isoDate: string): Date => new Date(`${isoDate}T00:00:00.000Z`);
export const fromDbDate = (d: Date): string => d.toISOString().slice(0, 10);
