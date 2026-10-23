/** Lines handed from "Cần nhập hàng" to a new receipt (sessionStorage, read once). */
export const RECEIPT_PREFILL_KEY = 'ketoan.receipt.prefill';

export type ReceiptPrefill = {
  ingredientId: number;
  /** Quantity in the purchase unit (thùng…) rather than the stock unit. */
  purchase: boolean;
  qty: string;
  unitPrice: string;
}[];

export function takeReceiptPrefill(): ReceiptPrefill | null {
  try {
    const raw = sessionStorage.getItem(RECEIPT_PREFILL_KEY);
    sessionStorage.removeItem(RECEIPT_PREFILL_KEY);
    return raw ? (JSON.parse(raw) as ReceiptPrefill) : null;
  } catch {
    return null;
  }
}
