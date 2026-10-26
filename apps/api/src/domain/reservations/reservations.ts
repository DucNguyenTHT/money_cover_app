// Table reservations (đặt bàn): when a table is taken, what to check before saving, the morning summary.
import { D, type Num } from '../money';
import { VN_OFFSET_MINUTES } from '../business-date';
import { escapeHtml } from '../notify/messages';

export interface Slot {
  /** ISO instant the guests are expected. */
  reservedAt: string;
  durationMin: number;
}

const end = (s: Slot) => Date.parse(s.reservedAt) + s.durationMin * 60_000;

/** The two bookings hold the table at the same time. */
export const overlaps = (a: Slot, b: Slot) =>
  Date.parse(a.reservedAt) < end(b) && Date.parse(b.reservedAt) < end(a);

/** "19:30" in shop time. */
export const shopTime = (iso: string) =>
  new Date(Date.parse(iso) + VN_OFFSET_MINUTES * 60_000).toISOString().slice(11, 16);

/** Why a booking cannot be saved (null = fine). */
export function reservationProblem(
  r: { reservedAt: string; guests: number; deposit: Num; depositMethod: string | null },
  now: Date,
): string | null {
  if (!Number.isFinite(Date.parse(r.reservedAt))) return 'Giờ đến không hợp lệ';
  // A little slack for typing in a booking the guests already showed up for.
  if (Date.parse(r.reservedAt) < now.getTime() - 60 * 60_000) return 'Giờ đến đã qua';
  if (r.guests < 1) return 'Số khách tối thiểu 1';
  if (D(r.deposit).lt(0)) return 'Tiền cọc không hợp lệ';
  if (D(r.deposit).gt(0) && r.depositMethod !== 'CASH' && r.depositMethod !== 'TRANSFER')
    return 'Chọn cách nhận cọc: tiền mặt hoặc chuyển khoản';
  return null;
}

/** Morning message line: "Đặt bàn hôm nay: 2 bàn, 10 khách — 11:30 Nam (6, Bàn 5), 19:00 Lan (4)". */
export function reservationsLine(
  rows: { reservedAt: string; name: string; guests: number; tableName: string | null }[],
) {
  if (!rows.length) return null;
  const guests = rows.reduce((s, r) => s + r.guests, 0);
  const shown = rows
    .slice(0, 6)
    .map(
      (r) =>
        `${shopTime(r.reservedAt)} ${escapeHtml(r.name)} (${r.guests}${r.tableName ? `, ${escapeHtml(r.tableName)}` : ''})`,
    );
  const more = rows.length > 6 ? ` và ${rows.length - 6} bàn khác` : '';
  return `Đặt bàn hôm nay: ${rows.length} bàn, ${guests} khách — ${shown.join(', ')}${more}`;
}
