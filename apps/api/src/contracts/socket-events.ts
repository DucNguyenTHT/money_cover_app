import type { Station } from '../domain/enums';

/** Events the server pushes to clients. Payloads are small "something changed" hints; clients refetch. */
export interface ServerToClientEvents {
  'table:update': (p: { tableId: number | null }) => void;
  'order:update': (p: { orderId: number }) => void;
  'kitchen:new': (p: { station: Station; orderId: number }) => void;
  'kitchen:update': (p: { station: Station; itemIds: number[] }) => void;
  'dish:availability': (p: { dishId: number; soldOut: boolean }) => void;
  'printer:error': (p: { printerName: string; message: string }) => void;
  /** Money arrived on the shop's bank account (tied to an order, or not yet). */
  'bank:txn': (p: { orderId: number | null; orderCode: string | null; amount: string }) => void;
}

export interface ClientToServerEvents {
  /** Kitchen / bar screens subscribe to their station's room. */
  'kitchen:join': (station: Station) => void;
}

export const socketRooms = {
  pos: 'pos',
  admin: 'admin',
  kitchen: (station: Station) => `kitchen:${station}`,
} as const;
