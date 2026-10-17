import { useQuery } from '@tanstack/react-query';
import { businessDateOf } from '@ketoan/api/domain';
import { today } from '@/components/MonthPicker';
import { client, ok } from './api-client';

/**
 * Today's business date (honours "giờ bắt đầu ngày kinh doanh": at 1 a.m. it is still yesterday when the day
 * starts at 04:00). Falls back to the calendar date until the settings have loaded.
 */
export function useBusinessToday(): string {
  const q = useQuery({
    queryKey: ['settings'],
    queryFn: async () => ok(await client.settings.get()),
    staleTime: 300_000,
  });
  const start = q.data?.settings.business_day_start;
  return start ? businessDateOf(new Date(), start) : today();
}
