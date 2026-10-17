import { D, Decimal, ZERO, roundVnd, type Num } from '../money';

export interface OpenLot {
  id: number;
  qtyRemaining: Num;
  unitPrice: Num;
}

export interface Allocation {
  lotId: number;
  qty: Decimal;
  unitPrice: Decimal;
}

export interface FifoResult {
  allocations: Allocation[];
  /** Quantity no lot could cover ("nợ kho"). */
  shortQty: Decimal;
  /** Cost of the allocated part, whole đồng. */
  allocatedCost: Decimal;
}

/**
 * Take `qty` from `lots` in the given order (caller sorts oldest first).
 * Never takes more than a lot has; whatever is left over is reported as `shortQty`.
 */
export function allocateFifo(lots: readonly OpenLot[], qty: Num): FifoResult {
  let need = D(qty);
  if (need.lt(0)) throw new Error('Số lượng xuất không được âm');
  const allocations: Allocation[] = [];
  let cost = ZERO;
  for (const lot of lots) {
    if (need.lte(0)) break;
    const avail = D(lot.qtyRemaining);
    if (avail.lte(0)) continue;
    const take = Decimal.min(avail, need);
    allocations.push({ lotId: lot.id, qty: take, unitPrice: D(lot.unitPrice) });
    cost = cost.add(take.mul(lot.unitPrice));
    need = need.sub(take);
  }
  return { allocations, shortQty: need.gt(0) ? need : ZERO, allocatedCost: roundVnd(cost) };
}

/** Value of allocations at their own lot prices, whole đồng. */
export const allocationsCost = (allocs: readonly { qty: Num; unitPrice: Num }[]): Decimal =>
  roundVnd(allocs.reduce<Decimal>((s, a) => s.add(D(a.qty).mul(a.unitPrice)), ZERO));

export interface PendingLine {
  issueItemId: number;
  pendingQty: Num;
}

export interface Settlement {
  issueItemId: number;
  qty: Decimal;
}

/**
 * A new lot arrived: use it to cover outstanding "nợ kho" lines, oldest first.
 * Returns how much of the lot goes to each line; the rest of the lot stays in stock.
 */
export function settlePending(
  lotQty: Num,
  pending: readonly PendingLine[],
): { settlements: Settlement[]; lotLeft: Decimal } {
  let left = D(lotQty);
  const settlements: Settlement[] = [];
  for (const p of pending) {
    if (left.lte(0)) break;
    const take = Decimal.min(left, D(p.pendingQty));
    if (take.lte(0)) continue;
    settlements.push({ issueItemId: p.issueItemId, qty: take });
    left = left.sub(take);
  }
  return { settlements, lotLeft: left };
}

/** Convert a quantity typed in purchase units (thùng) and its price into stock units (lon). */
export function toStockUnits(qty: Num, unitPrice: Num, purchaseFactor: Num) {
  const f = D(purchaseFactor);
  if (f.lte(0)) throw new Error('Hệ số đơn vị mua phải lớn hơn 0');
  return { qty: D(qty).mul(f), unitPrice: D(unitPrice).div(f) };
}
