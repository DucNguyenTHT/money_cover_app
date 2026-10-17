import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Bike, LayoutGrid, ReceiptText, ShoppingBag } from 'lucide-react';
import type { DishDto } from '@ketoan/api/contracts';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { client, errorMessage, ok } from '@/lib/api-client';
import { money } from '@/lib/format';
import { cn } from '@/lib/cn';
import { usePos } from '@/pos/context';
import { useMenu, useOrder } from '@/pos/data';
import { OrderPanel } from '@/pos/OrderPanel';

const TILES = [
  ['#eef4fe', '#3573dd'],
  ['#fef6ee', '#c4320a'],
  ['#ecfdf3', '#067647'],
  ['#f4f3ff', '#5925dc'],
] as const;

const initials = (name: string) =>
  name
    .replace(/[^\p{L}\s]/gu, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

/** Strip Vietnamese marks so "pho" finds "Phở". */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase();

export function OrderPage() {
  const { target, setTarget, search, addDish } = usePos();
  const navigate = useNavigate();
  const orderId = target && 'orderId' in target ? target.orderId : null;
  const order = useOrder(orderId).data;
  const channel = order?.channel ?? (target && 'draft' in target ? target.draft.channel : 'DINE_IN');
  const menu = useMenu(channel);
  const [cat, setCat] = useState<number | null>(null);
  const [showPanel, setShowPanel] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();

  const dishes = useMemo(() => (menu.data ?? []).filter((d) => d.active), [menu.data]);
  const cats = useMemo(() => {
    const m = new Map<number, { id: number; name: string; count: number }>();
    for (const d of dishes) {
      const c = m.get(d.categoryId) ?? { id: d.categoryId, name: d.categoryName, count: 0 };
      c.count += 1;
      m.set(d.categoryId, c);
    }
    return [...m.values()];
  }, [dishes]);
  const shown = dishes.filter((d) =>
    search
      ? fold(d.name).includes(fold(search)) || fold(d.code).includes(fold(search))
      : cat === null || d.categoryId === cat,
  );
  const inOrder = new Map<number, number>();
  for (const i of order?.items ?? [])
    if (i.status === 'ACTIVE') inOrder.set(i.dishId, (inOrder.get(i.dishId) ?? 0) + i.qty);
  const count = [...inOrder.values()].reduce((s, n) => s + n, 0);

  const toggleSoldOut = async (d: DishDto) => {
    if (!confirm(d.soldOut ? `Mở bán lại "${d.name}"?` : `Đánh dấu "${d.name}" đã hết hôm nay?`)) return;
    try {
      ok(await client.menu.setAvailability({ params: { id: d.id }, body: { soldOut: !d.soldOut } }));
      qc.invalidateQueries({ queryKey: ['pos', 'menu'] });
      toast(d.soldOut ? `Đã mở bán lại ${d.name}` : `${d.name}: đã hết`);
    } catch (e) {
      toast(errorMessage(e), 'bad');
    }
  };

  if (!target) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <div className="flex max-w-sm flex-col items-center gap-3 rounded-card bg-white p-8 text-center">
          <p className="font-semibold text-ink-strong">Gọi món cho ai?</p>
          <p className="text-[13px] text-muted">Chọn bàn trên sơ đồ, hoặc bắt đầu đơn mang về.</p>
          <div className="flex gap-2">
            <Button icon={<LayoutGrid size={18} />} onClick={() => navigate('/pos')}>
              Sơ đồ bàn
            </Button>
            <Button
              variant="primary"
              icon={<ShoppingBag size={18} />}
              onClick={() =>
                setTarget({
                  draft: { channel: 'TAKEAWAY', tableId: null, deliveryAppId: null, appOrderCode: null },
                })
              }
            >
              Mang về
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full gap-2 p-2">
      <main
        className={cn('min-w-0 flex-1 flex-col rounded-card bg-white', showPanel ? 'hidden lg:flex' : 'flex')}
      >
        <div className="flex min-h-0 flex-1">
          <nav
            aria-label="Nhóm món"
            className="hidden w-[168px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line p-2 md:flex"
          >
            <CatButton on={cat === null} onClick={() => setCat(null)} name="Tất cả" count={dishes.length} />
            {cats.map((c) => (
              <CatButton
                key={c.id}
                on={cat === c.id}
                onClick={() => setCat(c.id)}
                name={c.name}
                count={c.count}
              />
            ))}
          </nav>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex gap-1.5 overflow-x-auto border-b border-line p-2 md:hidden">
              {[{ id: null as number | null, name: 'Tất cả' }, ...cats].map((c) => (
                <button
                  key={c.id ?? 'all'}
                  onClick={() => setCat(c.id)}
                  className={cn(
                    'h-9 shrink-0 rounded-full px-3.5 text-[13px]',
                    cat === c.id ? 'bg-primary-soft font-semibold text-primary-ink' : 'bg-track text-muted',
                  )}
                >
                  {c.name}
                </button>
              ))}
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(132px,1fr))] content-start gap-2.5 overflow-y-auto p-3">
              {shown.map((d, i) => (
                <DishTile
                  key={d.id}
                  dish={d}
                  qty={inOrder.get(d.id) ?? 0}
                  colors={TILES[i % 4]!}
                  onAdd={() => addDish(d.id)}
                  onLongPress={() => toggleSoldOut(d)}
                  channelApp={channel === 'APP'}
                />
              ))}
              {menu.isSuccess && shown.length === 0 && (
                <p className="col-span-full py-10 text-center text-[13px] text-muted">
                  Không có món phù hợp.
                </p>
              )}
            </div>
            <p className="hidden border-t border-line px-3 py-1.5 text-xs text-faint md:block">
              Giữ lâu (hoặc chuột phải) vào món để đánh dấu hết / còn món.
            </p>
          </div>
        </div>
        {/* Phone & tablet: running total + open the order */}
        <div className="flex items-center gap-3 border-t border-line p-2.5 lg:hidden">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13px] text-muted">
              {order ? `${order.code} · ` : ''}
              {channel === 'APP' ? <Bike size={13} className="inline" /> : null} {count} món
            </span>
            <span className="num text-lg font-bold text-primary-ink">{money(order?.total ?? 0)}</span>
          </span>
          <Button
            variant="primary"
            size="lg"
            icon={<ReceiptText size={18} />}
            onClick={() => setShowPanel(true)}
          >
            Xem đơn
          </Button>
        </div>
      </main>
      <div
        className={cn(
          'min-w-0 shrink-0 lg:block lg:w-[380px] xl:w-[460px]',
          showPanel ? 'block w-full' : 'hidden',
        )}
      >
        <OrderPanel
          onPaid={() => navigate('/pos')}
          onClose={showPanel ? () => setShowPanel(false) : undefined}
        />
      </div>
    </div>
  );
}

function CatButton({
  on,
  onClick,
  name,
  count,
}: {
  on: boolean;
  onClick: () => void;
  name: string;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        'flex h-10 items-center justify-between rounded-ctl px-3 text-left text-sm',
        on ? 'bg-primary-soft font-semibold text-primary-ink' : 'font-medium text-[#344054] hover:bg-page',
      )}
    >
      <span className="truncate">{name}</span>
      <span className={cn('text-xs', on ? 'text-primary-ink' : 'text-faint')}>{count}</span>
    </button>
  );
}

function DishTile({
  dish,
  qty,
  colors,
  onAdd,
  onLongPress,
  channelApp,
}: {
  dish: DishDto;
  qty: number;
  colors: readonly [string, string];
  onAdd: () => void;
  onLongPress: () => void;
  channelApp: boolean;
}) {
  const timer = useRef<number | null>(null);
  const long = useRef(false);
  const price = channelApp ? dish.appPrice : dish.storePrice;
  const start = () => {
    long.current = false;
    timer.current = window.setTimeout(() => {
      long.current = true;
      onLongPress();
    }, 650);
  };
  const stop = () => timer.current && window.clearTimeout(timer.current);

  return (
    <button
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onContextMenu={(e) => {
        e.preventDefault();
        stop();
        if (!long.current) onLongPress();
        long.current = true;
      }}
      onClick={() => {
        if (long.current) return;
        if (dish.soldOut || !price) return;
        onAdd();
      }}
      aria-disabled={dish.soldOut || !price}
      className={cn(
        'relative flex flex-col overflow-hidden rounded-card bg-white text-left',
        qty ? 'border-2 border-primary' : 'border border-line',
        (dish.soldOut || !price) && 'opacity-50',
      )}
    >
      <span
        className="flex h-[72px] w-full items-center justify-center text-2xl font-bold"
        style={{ background: colors[0], color: colors[1] }}
      >
        {initials(dish.name)}
      </span>
      <span className="flex w-full flex-col gap-0.5 px-2.5 py-2">
        <span className="line-clamp-2 text-[13px] font-medium leading-tight">{dish.name}</span>
        <span className="num text-sm font-bold text-primary-ink">{price ? money(price) : 'Chưa có giá'}</span>
      </span>
      {qty > 0 && (
        <span className="absolute right-1.5 top-1.5 flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-primary px-1.5 text-xs font-bold text-white">
          {qty}
        </span>
      )}
      {dish.soldOut && (
        <span className="absolute left-1.5 top-1.5 rounded-md bg-bad px-1.5 py-0.5 text-[11px] font-bold text-white">
          Hết
        </span>
      )}
    </button>
  );
}
