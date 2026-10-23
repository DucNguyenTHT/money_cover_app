// Supplier debts (công nợ): what is still owed on each purchase receipt.
import { D, Decimal, ZERO, type Num } from '../money';

export interface PayableReceipt {
  id: number;
  date: string;
  amount: Num;
}

export interface PayablePayment {
  amount: Num;
  /** The receipt this payment was made for, if any. */
  receiptId: number | null;
}

/**
 * How much of each purchase receipt is paid. A payment made for a receipt goes to that receipt first; other payments
 * (and what is left over) pay the oldest receipts first. `advance` is money paid beyond every receipt.
 */
export function allocatePayments(
  receipts: readonly PayableReceipt[],
  payments: readonly PayablePayment[],
): { paid: Map<number, Decimal>; advance: Decimal } {
  const due = new Map(receipts.map((r) => [r.id, D(r.amount)]));
  const paid = new Map(receipts.map((r) => [r.id, ZERO]));
  const give = (id: number, amount: Decimal) => {
    const take = Decimal.min(due.get(id)!, amount);
    due.set(id, due.get(id)!.sub(take));
    paid.set(id, paid.get(id)!.add(take));
    return amount.sub(take);
  };
  let pool = ZERO;
  for (const p of payments) {
    const amount = D(p.amount);
    pool = pool.add(p.receiptId !== null && due.has(p.receiptId) ? give(p.receiptId, amount) : amount);
  }
  const oldestFirst = [...receipts].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  for (const r of oldestFirst) {
    if (pool.lte(0)) break;
    pool = give(r.id, pool);
  }
  return { paid, advance: pool };
}
