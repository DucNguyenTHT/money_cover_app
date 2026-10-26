// Requests guests send from the QR on their table: dishes to order, calling staff, asking for the bill.
// They never become an order by themselves — staff accept them on the till.
import type { TableRequestKind } from '../enums';

export interface RequestLine {
  dishId: number;
  qty: number;
  optionIds: number[];
  note: string | null;
}

export const QR_LIMITS = {
  lines: 30,
  qty: 20,
  /** Waiting requests per table / per phone: more means staff have not looked yet. */
  pendingPerTable: 5,
  pendingPerClient: 3,
  /** Requests older than this are no longer shown to staff (the guests left or asked in person). */
  staleMinutes: 180,
} as const;

/** Why the request cannot be sent (null = fine). */
export function requestProblem(kind: TableRequestKind, items: readonly RequestLine[]): string | null {
  if (kind !== 'ORDER') return items.length ? 'Yêu cầu này không kèm món' : null;
  if (!items.length) return 'Chọn món trước khi gửi';
  if (items.length > QR_LIMITS.lines) return `Tối đa ${QR_LIMITS.lines} dòng món một lần`;
  if (items.some((i) => !Number.isInteger(i.qty) || i.qty < 1 || i.qty > QR_LIMITS.qty))
    return `Mỗi món từ 1 đến ${QR_LIMITS.qty} phần`;
  return null;
}

/** Same dish, options and note → one line. */
export function mergeLines(items: readonly RequestLine[]): RequestLine[] {
  const out: RequestLine[] = [];
  for (const i of items) {
    const optionIds = [...new Set(i.optionIds)].sort((a, b) => a - b);
    const note = i.note?.trim() || null;
    const same = out.find(
      (o) => o.dishId === i.dishId && o.note === note && o.optionIds.join(',') === optionIds.join(','),
    );
    if (same) same.qty += i.qty;
    else out.push({ dishId: i.dishId, qty: i.qty, optionIds, note });
  }
  return out;
}

/** Toast / notification on the tills: "Bàn 5 gọi món (3 phần)". */
export function requestTitle(
  kind: TableRequestKind,
  tableName: string,
  items: readonly RequestLine[],
): string {
  if (kind === 'CALL') return `${tableName} gọi nhân viên`;
  if (kind === 'BILL') return `${tableName} xin thanh toán`;
  return `${tableName} gọi món (${items.reduce((s, i) => s + i.qty, 0)} phần)`;
}
