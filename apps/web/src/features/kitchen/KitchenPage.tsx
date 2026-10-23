import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban } from 'lucide-react';
import type { KitchenItem } from '@ketoan/api/contracts';
import type { Station } from '@ketoan/api/domain';
import { useAuth } from '@/auth/AuthProvider';
import { IconButton } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Segmented, Switch } from '@/components/ui/controls';
import { useToast } from '@/components/ui/Toast';
import { client, errorMessage, ok } from '@/lib/api-client';
import { useRealtime } from '@/lib/socket';
import { cn } from '@/lib/cn';
import { minutesSince, posKeys } from '@/pos/data';

/** The three action icons, drawn once so the legend and the buttons are the same glyphs. */
const DoneIcon = ({ size = 18 }: { size?: number }) => (
  <svg
    aria-hidden
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M5 12l5 5L19 7" />
  </svg>
);
const DoneAllIcon = ({ size = 18 }: { size?: number }) => (
  <svg
    aria-hidden
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M2 12l5 5L17 7M12 16l1 1L22 7" />
  </svg>
);
const ServedIcon = ({ size = 18 }: { size?: number }) => (
  <svg
    aria-hidden
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 17h16M6 17a6 6 0 0 1 12 0M12 8V6M9 21h6" />
  </svg>
);

const STATION_KEY = 'ketoan.kitchen.station';
const waitTone = (m: number) =>
  m >= 20
    ? { fg: 'font-bold text-bad-ink', bg: 'bg-bad-soft' }
    : m >= 10
      ? { fg: 'font-semibold text-warn', bg: 'bg-warn-soft' }
      : { fg: 'text-muted', bg: '' };

/** Short chime when a new ticket arrives (no audio file needed). */
function chime() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.4);
  } catch {
    /* audio blocked until the first tap */
  }
}

export function KitchenPage() {
  const { user } = useAuth();
  const fixed = user?.role === 'KITCHEN' ? (user.station ?? 'KITCHEN') : null;
  const [picked, setPicked] = useState<Station>(() => {
    try {
      return (localStorage.getItem(STATION_KEY) as Station) || 'KITCHEN';
    } catch {
      return 'KITCHEN';
    }
  });
  const station: Station = fixed ?? picked;
  const [view, setView] = useState<'dish' | 'table'>('dish');
  const [soldOutOpen, setSoldOutOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const qc = useQueryClient();
  const toast = useToast();

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(t);
  }, []);

  const q = useQuery({
    queryKey: posKeys.kitchen(station),
    queryFn: async () => ok(await client.kitchen.queue({ query: { station } })),
    refetchInterval: 60_000,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: posKeys.kitchen(station) });
  useRealtime(
    {
      'kitchen:new': (p) => {
        if (p.station === station) {
          chime();
          refresh();
        }
      },
      'kitchen:update': (p) => p.station === station && refresh(),
    },
    station,
  );

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      refresh();
    } catch (e) {
      toast(errorMessage(e), 'bad');
    }
  };
  const setStatus = (itemId: number, status: 'DONE' | 'SERVED') =>
    act(async () => ok(await client.kitchen.setStatus({ params: { itemId }, body: { status } })));

  const items = q.data ?? [];
  const waiting = items.filter((i) => i.kitchenStatus === 'SENT');
  const done = items.filter((i) => i.kitchenStatus === 'DONE');
  const label = station === 'BAR' ? 'Quầy bar' : 'Bếp';

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3 rounded-card bg-white px-3 py-2">
        {fixed ? (
          <span className="text-[17px] font-bold text-nav-ink">{label}</span>
        ) : (
          <Segmented
            label="Trạm"
            value={station}
            onChange={(s) => {
              setPicked(s);
              try {
                localStorage.setItem(STATION_KEY, s);
              } catch {
                /* ignore */
              }
            }}
            options={[
              { value: 'KITCHEN', label: 'Bếp' },
              { value: 'BAR', label: 'Bar' },
            ]}
          />
        )}
        <Segmented
          label="Kiểu xem"
          value={view}
          onChange={setView}
          options={[
            { value: 'dish', label: 'Theo món' },
            { value: 'table', label: 'Theo bàn' },
          ]}
        />
        <button
          onClick={() => setSoldOutOpen(true)}
          className="inline-flex h-9 items-center gap-1.5 rounded-ctl border border-field bg-white px-3 text-[13px] font-medium shadow-[var(--shadow-btn)]"
        >
          <Ban size={16} /> Hết món
        </button>
        <div className="flex-1" />
        <div
          aria-label="Chú thích ký hiệu"
          className="flex flex-wrap items-center gap-3.5 rounded-ctl bg-page px-3 py-1.5 text-[13px] text-muted"
        >
          <LegendIcon className="text-pay" label="Xong">
            <DoneIcon size={14} />
          </LegendIcon>
          <LegendIcon className="text-primary-ink" label="Xong tất cả">
            <DoneAllIcon size={14} />
          </LegendIcon>
          <LegendIcon className="text-muted" label="Đã ra món">
            <ServedIcon size={14} />
          </LegendIcon>
          <span className="h-4 w-px bg-field" />
          <span className="flex items-center gap-1.5">
            <span className="size-3.5 rounded-[3px] bg-warn-soft ring-1 ring-warn" />
            Chờ ≥ 10 phút
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-3.5 rounded-[3px] bg-bad-soft ring-2 ring-bad" />
            Chờ ≥ 20 phút
          </span>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-2 md:grid-cols-2">
        <section className="flex min-h-0 flex-col rounded-card bg-white">
          <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="font-bold">
              Chờ chế biến{' '}
              <span className="ml-1 rounded-full bg-bad-soft px-2 py-0.5 text-[13px] text-bad-ink">
                {waiting.length}
              </span>
            </span>
            <IconButton
              label="Xong tất cả"
              size={36}
              className="text-primary-ink"
              disabled={!waiting.length}
              onClick={() => act(async () => ok(await client.kitchen.doneAll({ body: { station } })))}
            >
              <DoneAllIcon />
            </IconButton>
          </header>
          <Rows
            items={waiting}
            view={view}
            now={now}
            action={(i) => (
              <IconButton label="Xong" className="text-pay" onClick={() => setStatus(i.itemId, 'DONE')}>
                <DoneIcon />
              </IconButton>
            )}
          />
        </section>
        <section className="flex min-h-0 flex-col rounded-card bg-white">
          <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="font-bold">
              Đã xong – chờ ra món{' '}
              <span className="ml-1 rounded-full bg-good-soft px-2 py-0.5 text-[13px] text-good">
                {done.length}
              </span>
            </span>
          </header>
          <Rows
            items={done}
            view={view}
            now={now}
            hideWait
            action={(i) => (
              <IconButton label="Đã ra món" onClick={() => setStatus(i.itemId, 'SERVED')}>
                <ServedIcon />
              </IconButton>
            )}
          />
        </section>
      </div>

      <SoldOutDialog open={soldOutOpen} onClose={() => setSoldOutOpen(false)} station={station} />
    </div>
  );
}

function LegendIcon({
  className,
  label,
  children,
}: {
  className: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn(
          'inline-flex size-[26px] items-center justify-center rounded-lg border border-field bg-white',
          className,
        )}
      >
        {children}
      </span>
      {label}
    </span>
  );
}

function Rows({
  items,
  view,
  now,
  action,
  hideWait,
}: {
  items: KitchenItem[];
  view: 'dish' | 'table';
  now: number;
  action: (i: KitchenItem) => React.ReactNode;
  hideWait?: boolean;
}) {
  const groups = useMemo(() => {
    if (view === 'dish') return [{ key: 'all', title: null as string | null, items }];
    const m = new Map<number, { key: string; title: string; items: KitchenItem[] }>();
    for (const i of items) {
      const g = m.get(i.orderId) ?? {
        key: String(i.orderId),
        title: `${i.where} · ${i.orderCode}`,
        items: [],
      };
      g.items.push(i);
      m.set(i.orderId, g);
    }
    return [...m.values()];
  }, [items, view]);

  if (!items.length) return <p className="py-12 text-center text-[13px] text-muted">Không có món.</p>;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {groups.map((g) => (
        <div key={g.key}>
          {g.title && (
            <div className="bg-page px-4 py-1.5 text-[13px] font-semibold text-ink-strong">{g.title}</div>
          )}
          {g.items.map((i) => {
            const m = minutesSince(i.sentAt, now);
            const t = waitTone(m);
            return (
              <div
                key={i.itemId}
                className={cn(
                  'grid grid-cols-[minmax(0,1fr)_40px_auto_40px] items-center gap-3 border-b border-[#f2f4f7] px-4 py-2.5 xl:grid-cols-[minmax(0,1fr)_52px_150px_72px_40px]',
                  !hideWait && t.bg,
                )}
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-semibold">{i.dishName}</span>
                  {i.options && (
                    <span className="text-[13px] font-semibold text-primary-ink">{i.options}</span>
                  )}
                  {i.note && <span className="text-[13px] text-warn">{i.note}</span>}
                  {/* Narrow columns (tablets): where it goes sits under the dish name. */}
                  {view === 'dish' && (
                    <span className="truncate text-[13px] text-muted xl:hidden">{i.where}</span>
                  )}
                </span>
                <span className="num text-center text-lg font-bold">{i.qty}</span>
                <span className="hidden truncate text-sm text-[#344054] xl:block">
                  {view === 'dish' ? i.where : ''}
                </span>
                <span
                  className={cn(
                    'num whitespace-nowrap text-right text-sm font-bold',
                    hideWait ? 'text-faint' : t.fg,
                  )}
                >
                  {hideWait ? '' : `${m} phút`}
                </span>
                {action(i)}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function SoldOutDialog({ open, onClose, station }: { open: boolean; onClose: () => void; station: Station }) {
  const qc = useQueryClient();
  const toast = useToast();
  const menu = useQuery({
    queryKey: ['pos', 'menu', 'kitchen'],
    queryFn: async () => ok(await client.menu.listDishes({ query: {} })),
    enabled: open,
  });
  const dishes = (menu.data ?? []).filter((d) => d.active && d.station === station);
  return (
    <Dialog open={open} onClose={onClose} title="Đánh dấu hết món (hôm nay)" width={460}>
      <div className="flex flex-col gap-3">
        {dishes.map((d) => (
          <Switch
            key={d.id}
            checked={d.soldOut}
            label={d.name}
            description={d.soldOut ? 'Đã hết — POS không gọi được' : undefined}
            onChange={async (v) => {
              try {
                ok(await client.menu.setAvailability({ params: { id: d.id }, body: { soldOut: v } }));
                qc.invalidateQueries({ queryKey: ['pos', 'menu'] });
              } catch (e) {
                toast(errorMessage(e), 'bad');
              }
            }}
          />
        ))}
        {menu.isSuccess && !dishes.length && (
          <p className="text-[13px] text-muted">Không có món nào của trạm này.</p>
        )}
      </div>
    </Dialog>
  );
}
