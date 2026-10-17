import type { OrderStatus, Role } from '../enums';

export interface CancelContext {
  status: OrderStatus;
  orderDate: string;
  today: string;
  role: Role;
  /** The order's business day has already been closed (cash counted). */
  dayClosed: boolean;
}

/**
 * Who may cancel an order:
 * - OPEN: anyone selling (with a reason).
 * - PAID today, day not closed: staff too.
 * - PAID on an earlier day, or the day was closed: ADMIN only (logged in, or approving with PIN at the till).
 */
export function cancelRule(c: CancelContext): 'ALLOWED' | 'NEEDS_ADMIN' | 'NOT_CANCELLABLE' {
  if (c.status === 'CANCELLED') return 'NOT_CANCELLABLE';
  if (c.role === 'ADMIN') return 'ALLOWED';
  if (c.status === 'OPEN') return 'ALLOWED';
  if (c.orderDate === c.today && !c.dayClosed) return 'ALLOWED';
  return 'NEEDS_ADMIN';
}

/** Order code YYMMDD-### from the business date and the day's running number. */
export function orderCode(businessDate: string, no: number): string {
  const [y, m, d] = businessDate.split('-');
  return `${y!.slice(2)}${m}${d}-${String(no).padStart(3, '0')}`;
}
