// Queries and the realtime wiring shared by every selling screen (/pos, /kitchen, order history).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { OrderDto } from '@ketoan/api/contracts';
import type { Channel } from '@ketoan/api/domain';
import { client, ok } from '@/lib/api-client';
import { useRealtime } from '@/lib/socket';

export const posKeys = {
  floor: ['pos', 'floor'] as const,
  order: (id: number) => ['pos', 'order', id] as const,
  orders: ['pos', 'orders'] as const,
  menu: (channel: Channel) => ['pos', 'menu', channel] as const,
  categories: ['pos', 'categories'] as const,
  approvers: ['pos', 'approvers'] as const,
  apps: ['pos', 'apps'] as const,
  settings: ['pos', 'settings'] as const,
  kitchen: (station: string) => ['pos', 'kitchen', station] as const,
  day: (date: string) => ['pos', 'day', date] as const,
};

export const useFloor = () =>
  useQuery({ queryKey: posKeys.floor, queryFn: async () => ok(await client.orders.floor()) });

export const useOrder = (id: number | null) =>
  useQuery({
    queryKey: posKeys.order(id ?? 0),
    queryFn: async () => ok(await client.orders.get({ params: { id: id! } })),
    enabled: !!id,
  });

export const useMenu = (channel: Channel) =>
  useQuery({
    queryKey: posKeys.menu(channel),
    queryFn: async () => ok(await client.menu.listDishes({ query: { channel } })),
    staleTime: 60_000,
  });

export const useCategories = () =>
  useQuery({
    queryKey: posKeys.categories,
    queryFn: async () => ok(await client.menu.listCategories()),
    staleTime: 300_000,
  });

export const useApprovers = () =>
  useQuery({
    queryKey: posKeys.approvers,
    queryFn: async () => ok(await client.users.approvers()),
    staleTime: 300_000,
  });

export const useDeliveryApps = () =>
  useQuery({
    queryKey: posKeys.apps,
    queryFn: async () => ok(await client.venue.listDeliveryApps()),
    staleTime: 300_000,
  });

export const usePosSettings = () =>
  useQuery({
    queryKey: posKeys.settings,
    queryFn: async () => ok(await client.settings.get()),
    staleTime: 300_000,
  });

/** Keep every POS query fresh from server pushes (other tills, kitchen, sold-out flags, printer problems). */
export function usePosRealtime(onPrinterError?: (message: string) => void) {
  const qc = useQueryClient();
  useRealtime({
    'printer:error': ({ printerName, message }) => onPrinterError?.(`Máy in ${printerName}: ${message}`),
    'table:update': () => qc.invalidateQueries({ queryKey: posKeys.floor }),
    'order:update': ({ orderId }) => {
      qc.invalidateQueries({ queryKey: posKeys.order(orderId) });
      qc.invalidateQueries({ queryKey: posKeys.floor });
      qc.invalidateQueries({ queryKey: posKeys.orders });
    },
    'dish:availability': () => qc.invalidateQueries({ queryKey: ['pos', 'menu'] }),
  });
}

/** Put a fresh order into the cache right after a mutation (no extra round trip). */
export function useSetOrder() {
  const qc = useQueryClient();
  return (o: OrderDto) => {
    qc.setQueryData(posKeys.order(o.id), o);
    qc.invalidateQueries({ queryKey: posKeys.floor });
  };
}

export const CHANNEL_LABEL: Record<Channel, string> = {
  DINE_IN: 'Tại bàn',
  TAKEAWAY: 'Mang về',
  APP: 'App giao hàng',
};

export const whereLabel = (
  o: Pick<OrderDto, 'channel' | 'tableName' | 'deliveryAppName' | 'appOrderCode' | 'code'>,
) =>
  o.channel === 'DINE_IN'
    ? (o.tableName ?? 'Tại bàn')
    : o.channel === 'APP'
      ? `${o.deliveryAppName ?? 'App'}${o.appOrderCode ? ` #${o.appOrderCode}` : ''}`
      : `Mang về #${o.code.slice(-3)}`;

/** "12′" minutes since an ISO time. */
export const minutesSince = (iso: string, now = Date.now()) =>
  Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
