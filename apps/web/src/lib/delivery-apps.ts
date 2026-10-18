import { useQuery } from '@tanstack/react-query';
import type { PriceType } from '@ketoan/api/domain';
import { client, ok } from '@/lib/api-client';

export function useDeliveryApps() {
  return useQuery({
    queryKey: ['delivery-apps'],
    queryFn: async () => ok(await client.venue.listDeliveryApps()),
  });
}

/** Label of a price row: store, general app price, or "App · <name>" for one app's own price. */
export function priceTypeLabel(
  p: { priceType: PriceType; deliveryAppId: number | null },
  apps: { id: number; name: string }[] | undefined,
) {
  if (p.priceType === 'STORE') return 'Tại quán / mang về';
  if (p.deliveryAppId === null) return 'App (giá chung)';
  return `App · ${apps?.find((a) => a.id === p.deliveryAppId)?.name ?? `#${p.deliveryAppId}`}`;
}
