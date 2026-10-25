// Money arriving on the shop's bank account (read from SePay / Casso) matched to orders. The VietQR on the bill
// carries the order code as the transfer content; banks rewrite that content freely (drop the dash, add their
// own prefix / suffix, change case), so codes are compared on letters and digits only.
import { D, ZERO, type Num } from '../money';

/** Uppercase letters and digits only, without Vietnamese marks: "Ck đơn 261023-015" → "CKDON261023015". */
export function compactText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'D')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * The order code written in a transfer description, among `codes` (orders of the days around the transfer).
 * The longest code found wins (so "261023-1000" beats "261023-100"); null when none appears.
 */
export function codeInDescription(description: string, codes: readonly string[]): string | null {
  const text = compactText(description);
  let best: string | null = null;
  let bestLen = 0;
  for (const code of codes) {
    const c = compactText(code);
    if (c.length >= 6 && c.length > bestLen && text.includes(c)) {
      best = code;
      bestLen = c.length;
    }
  }
  return best;
}

/** A till waiting for a transfer: the order whose payment screen shows the QR, and the amount it waits for. */
export interface Waiting {
  orderId: number;
  amount: Num;
}

/**
 * A transfer without a recognisable order code (the customer typed the amount by hand) goes to the till waiting
 * for exactly that amount — only when one till waits for it, never a guess between two.
 */
export function orderByAmount(amount: Num, waiting: readonly Waiting[]): number | null {
  const same = waiting.filter((w) => D(w.amount).equals(D(amount)));
  const ids = [...new Set(same.map((w) => w.orderId))];
  return ids.length === 1 ? ids[0]! : null;
}

export type TransferCheck = 'OK' | 'SHORT' | 'OVER';

/**
 * A paid order's transfers against the money that arrived: OK when the bank shows the transfer amount, SHORT
 * when less (or nothing) arrived, OVER when more arrived (paid twice, or a cancelled order that was paid).
 */
export function transferCheck(expected: Num, received: Num): TransferCheck {
  const e = D(expected);
  const r = D(received);
  if (r.equals(e)) return 'OK';
  return r.lt(e) ? 'SHORT' : 'OVER';
}

/** Totals for a day: what the tills recorded as transfers, what the bank shows for those orders. */
export function transferSummary(orders: readonly { expected: Num; received: Num }[]) {
  let expected = ZERO;
  let received = ZERO;
  let short = 0;
  for (const o of orders) {
    expected = expected.add(D(o.expected));
    received = received.add(D(o.received));
    if (transferCheck(o.expected, o.received) === 'SHORT') short += 1;
  }
  return { expected, received, short };
}

/** "2025-08-15 09:30:00" or "2025-08-15T09:30:00" in shop time (UTC+7, as bank feeds write it) → instant. */
export function parseShopTime(s: string): Date {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/.exec(s.trim());
  if (!m) return new Date(NaN);
  const time = m[2]!.length === 5 ? `${m[2]}:00` : m[2];
  return new Date(`${m[1]}T${time}+07:00`);
}
