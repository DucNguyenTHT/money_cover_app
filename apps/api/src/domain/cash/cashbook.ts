// Cash book (sổ quỹ): money in / out of the till besides sales.
import { D, Decimal, ZERO, type Num } from '../money';

/**
 * Suggested categories when typing an entry (the owner can type others). Paying a supplier or wages is done on
 * those screens, which write their own entries, so the debt / payroll stays right.
 */
export const CASH_CATEGORIES = {
  IN: ['Tiền lẻ đầu ngày', 'Rút tiền ngân hàng về két', 'Thu khác'],
  OUT: ['Chi chợ', 'Nộp ngân hàng', 'Chi khác'],
} as const;

export interface CashLine {
  direction: 'IN' | 'OUT';
  amount: Num;
  cancelled: boolean;
}

export function cashTotals(lines: readonly CashLine[]): { in: Decimal; out: Decimal } {
  let inSum = ZERO;
  let outSum = ZERO;
  for (const l of lines) {
    if (l.cancelled) continue;
    if (l.direction === 'IN') inSum = inSum.add(l.amount);
    else outSum = outSum.add(l.amount);
  }
  return { in: inSum, out: outSum };
}

/** Cash the till should hold at closing: cash sales + money put in − money taken out. */
export const expectedCash = (cashSales: Num, lines: readonly CashLine[]) => {
  const t = cashTotals(lines);
  return D(cashSales).add(t.in).sub(t.out);
};

/**
 * Who may cancel an entry (always with a reason): ADMIN any typed entry; the person who wrote it, the same business
 * day. Entries made by another screen (supplier payment, payroll, salary advance) are cancelled there.
 */
export function canCancelCash(e: {
  role: 'ADMIN' | 'STAFF' | 'KITCHEN';
  isAuthor: boolean;
  sameDay: boolean;
  automatic: boolean;
}): string | null {
  if (e.automatic) return 'Khoản này do màn hình khác tạo (trả nhà cung cấp, lương, tạm ứng) — huỷ ở đó';
  if (e.role === 'ADMIN') return null;
  if (e.isAuthor && e.sameDay) return null;
  return 'Chỉ người ghi (trong ngày) hoặc ADMIN được huỷ khoản này';
}
