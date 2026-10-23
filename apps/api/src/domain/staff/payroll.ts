// Staff: shift hours, clock times on a business day, monthly pay.
import { D, roundVnd, type Decimal, type Num } from '../money';
import { parseDayStart, VN_OFFSET_MINUTES } from '../business-date';

/** "HH:mm" → minutes after midnight; null when not a valid time. */
export function clockMinutes(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Length of a shift in hours; a shift past midnight ("22:00"–"02:00") is 4 h. */
export function shiftHours(start: string, end: string): number {
  const a = clockMinutes(start);
  const b = clockMinutes(end);
  if (a === null || b === null) return 0;
  return ((b - a + 24 * 60) % (24 * 60) || 24 * 60) / 60;
}

/**
 * The instant of a clock time on a business date (Vietnam time). Times before the business-day start belong to the
 * next calendar day: with the day starting at 04:00, "01:30" on the 5th is 01:30 on the 6th.
 */
export function clockToInstant(date: string, hhmm: string, dayStart = '00:00'): Date {
  const min = clockMinutes(hhmm);
  if (min === null) throw new Error(`Giờ không hợp lệ: ${hhmm}`);
  const nextDay = min < parseDayStart(dayStart) ? 1 : 0;
  return new Date(Date.parse(`${date}T00:00:00Z`) + (nextDay * 24 * 60 + min - VN_OFFSET_MINUTES) * 60_000);
}

/** "HH:mm" (Vietnam time) of an instant. */
export function instantToClock(d: Date): string {
  return new Date(d.getTime() + VN_OFFSET_MINUTES * 60_000).toISOString().slice(11, 16);
}

/** Hours between check-in and check-out, to 0.01 h; 0 while either is missing. */
export function workedHours(checkIn: Date | null, checkOut: Date | null): Decimal {
  if (!checkIn || !checkOut || checkOut <= checkIn) return D(0);
  return D(checkOut.getTime() - checkIn.getTime())
    .div(3_600_000)
    .toDecimalPlaces(2);
}

export interface PayInput {
  payType: 'HOURLY' | 'MONTHLY';
  /** Per hour (HOURLY) or per month (MONTHLY). */
  rate: Num;
  hours: Num;
  bonus: Num;
  deduction: Num;
  /** Already given during the month. */
  advance: Num;
}

/**
 * Pay for a month. `gross` (base + bonus − deduction) is what the month costs the shop (it goes to overheads);
 * `toPay` is what is still to hand over after the advances.
 */
export function monthPay(p: PayInput): { basePay: Decimal; gross: Decimal; toPay: Decimal } {
  const basePay = roundVnd(p.payType === 'HOURLY' ? D(p.hours).mul(p.rate) : D(p.rate));
  const gross = basePay.add(p.bonus).sub(p.deduction);
  return { basePay, gross, toPay: gross.sub(p.advance) };
}
