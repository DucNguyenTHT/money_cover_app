import { useState } from 'react';
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

/**
 * A date field that defaults to today's business date (or `base(today)`). Until the user picks a date it follows
 * that default: a form opened before the settings loaded would otherwise keep the calendar date — between midnight
 * and the business-day start that is already "tomorrow" (prices / stock dated a day too late).
 */
export function useBusinessDateState(base?: (today: string) => string): [string, (v: string) => void] {
  const bizToday = useBusinessToday();
  const [picked, setPicked] = useState<string | null>(null);
  return [picked ?? (base ? base(bizToday) : bizToday), setPicked];
}
