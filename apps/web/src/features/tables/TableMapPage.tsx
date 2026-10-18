import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { AlertTriangle, Bike, ShoppingBag, UtensilsCrossed } from 'lucide-react';
import type { OrderSummary } from '@ketoan/api/contracts';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Segmented } from '@/components/ui/controls';
import { dateVi, money } from '@/lib/format';
import { useBusinessToday } from '@/lib/business-date';
import { cn } from '@/lib/cn';
import { usePos } from '@/pos/context';
import { minutesSince, useDeliveryApps, useFloor, whereLabel } from '@/pos/data';
import { OrderPanel } from '@/pos/OrderPanel';

type Filter = 'all' | 'used' | 'free';
const OTHERS = -1;

const tone = (orders: OrderSummary[]) =>
  orders.length === 0
    ? 'border-line bg-white text-muted'
    : orders.some((o) => o.billPrintedAt)
      ? 'border-[#fbd9ae] bg-[#fff1df] text-[#9a5a12]'
      : 'border-[#c7dbfb] bg-[#e3eefd] text-[#1f4fa0]';

/** Hook re-rendering every 30 s so "ngồi 25′" stays current. */
function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function TableMapPage() {
  const floor = useFloor();
  const { target, setTarget } = usePos();
  const navigate = useNavigate();
  const now = useNow();
  const [filter, setFilter] = useState<Filter>('all');
  const [areaId, setAreaId] = useState<number | null>(null);
  const [appOpen, setAppOpen] = useState(false);
  const bizToday = useBusinessToday();

  const areas = floor.data?.areas ?? [];
  const others = floor.data?.others ?? [];
  const current = areaId ?? areas[0]?.id ?? OTHERS;
  const allTables = areas.flatMap((a) => a.tables);
  const used = allTables.filter((t) => t.orders.length).length;
  const selectedOrder = target && 'orderId' in target ? target.orderId : null;
  const selectedTable = useMemo(
    () =>
      target && 'draft' in target
        ? target.draft.tableId
        : allTables.find((t) => t.orders.some((o) => o.id === selectedOrder))?.id,
    [target, allTables, selectedOrder],
  );

  /** On phones/tablets the panel lives on the menu screen; on desktop it sits beside the map. */
  const wide = () => window.matchMedia('(min-width: 1024px)').matches;
  const go = () => {
    if (!wide()) navigate('/pos/order');
  };

  const pickTable = (t: (typeof allTables)[number]) => {
    if (t.orders.length) setTarget({ orderId: t.orders[0]!.id });
    else
      setTarget({
        draft: {
          channel: 'DINE_IN',
          tableId: t.id,
          tableName: t.name,
          deliveryAppId: null,
          appOrderCode: null,
        },
      });
    go();
  };

  // Orders left open from an earlier business day block that day's cash closing.
  const stale = [...allTables.flatMap((t) => t.orders), ...others].filter((o) => o.businessDate < bizToday);
  const openStale = () => {
    const o = stale[0]!;
    const area = areas.find((a) => a.tables.some((t) => t.orders.some((x) => x.id === o.id)));
    setAreaId(area?.id ?? OTHERS);
    setTarget({ orderId: o.id });
    go();
  };

  const tables = (areas.find((a) => a.id === current)?.tables ?? []).filter((t) =>
    filter === 'all' ? true : filter === 'used' ? t.orders.length > 0 : t.orders.length === 0,
  );

  return (
    <div className="flex h-full gap-2 p-2">
      <main className="flex min-w-0 flex-1 flex-col rounded-card bg-white">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-3.5 py-2.5">
          <Segmented
            label="Lọc bàn"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: `Tất cả (${allTables.length})` },
              { value: 'used', label: `Sử dụng (${used})` },
              { value: 'free', label: `Còn trống (${allTables.length - used})` },
            ]}
          />
          <div className="flex-1" />
          <Button
            icon={<ShoppingBag size={18} />}
            onClick={() => {
              setTarget({
                draft: { channel: 'TAKEAWAY', tableId: null, deliveryAppId: null, appOrderCode: null },
              });
              navigate('/pos/order');
            }}
          >
            Mang về
          </Button>
          <Button icon={<Bike size={18} />} onClick={() => setAppOpen(true)}>
            App
          </Button>
          <Button
            variant="primary"
            icon={<UtensilsCrossed size={18} />}
            disabled={!target}
            onClick={() => navigate('/pos/order')}
            className="hidden lg:inline-flex"
          >
            Gọi món
          </Button>
        </div>
        {stale.length > 0 && (
          <button
            onClick={openStale}
            className="flex items-center gap-2 border-b border-line bg-warn-soft px-3.5 py-2 text-left text-[13px] text-warn hover:underline"
          >
            <AlertTriangle size={16} className="shrink-0" />
            {stale.length} đơn còn mở từ ngày trước ({stale.map((o) => dateVi(o.businessDate)).join(', ')}) —
            thanh toán hoặc huỷ để chốt được ngày đó
          </button>
        )}
        <div
          role="tablist"
          aria-label="Khu vực"
          className="flex gap-5 overflow-x-auto border-b border-line px-3.5 text-[13px]"
        >
          {areas.map((a) => (
            <AreaTab key={a.id} on={current === a.id} onClick={() => setAreaId(a.id)}>
              {a.name}
            </AreaTab>
          ))}
          <AreaTab on={current === OTHERS} onClick={() => setAreaId(OTHERS)}>
            Mang về / App ({others.length})
          </AreaTab>
        </div>

        <div className="grid min-h-0 flex-1 auto-rows-[104px] grid-cols-[repeat(auto-fill,minmax(112px,1fr))] content-start gap-2.5 overflow-y-auto p-3.5">
          {current === OTHERS
            ? others.map((o) => (
                <Tile
                  key={o.id}
                  selected={o.id === selectedOrder}
                  className={tone([o])}
                  onClick={() => (setTarget({ orderId: o.id }), go())}
                >
                  {o.channel === 'APP' ? (
                    <Bike size={26} strokeWidth={1.6} />
                  ) : (
                    <ShoppingBag size={26} strokeWidth={1.6} />
                  )}
                  <span className="max-w-full truncate text-sm font-bold">{whereLabel(o)}</span>
                  <span className="num text-xs font-medium">
                    {money(o.total)} · {minutesSince(o.openedAt, now)}′
                  </span>
                </Tile>
              ))
            : tables.map((t) => {
                const total = t.orders.reduce((s, o) => s + Number(o.total), 0);
                return (
                  <Tile
                    key={t.id}
                    selected={t.id === selectedTable}
                    className={tone(t.orders)}
                    onClick={() => pickTable(t)}
                  >
                    <TableIcon />
                    <span className="text-sm font-bold">{t.name}</span>
                    <span className="num text-xs font-medium">
                      {t.orders.length
                        ? `${money(total)} · ${minutesSince(t.orders[0]!.openedAt, now)}′`
                        : `${t.seats} chỗ`}
                    </span>
                    {t.orders.length > 1 && (
                      <span className="absolute left-1.5 top-1.5 rounded-full bg-white px-1.5 text-[11px] font-bold">
                        {t.orders.length} đơn
                      </span>
                    )}
                  </Tile>
                );
              })}
          {current === OTHERS && others.length === 0 && (
            <p className="col-span-full py-10 text-center text-[13px] text-muted">
              Không có đơn mang về / app đang mở.
            </p>
          )}
          {current !== OTHERS && areas.length === 0 && (
            <p className="col-span-full py-10 text-center text-[13px] text-muted">
              Chưa có bàn — ADMIN thêm ở Hệ thống → Bàn & khu vực.
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-4 border-t border-line px-3.5 py-2.5 text-xs text-muted">
          <Legend className="bg-[#c7dbfb]">Đang dùng</Legend>
          <Legend className="bg-[#fbd9ae]">Đã in tạm tính – chờ thanh toán</Legend>
          <Legend className="border border-field bg-[#f2f4f7]">Còn trống</Legend>
        </div>
      </main>

      <div className="hidden w-[380px] shrink-0 lg:block xl:w-[460px]">
        <OrderPanel />
      </div>

      <AppOrderDialog
        open={appOpen}
        onClose={() => setAppOpen(false)}
        onStart={(deliveryAppId, appOrderCode) => {
          setAppOpen(false);
          setTarget({ draft: { channel: 'APP', tableId: null, deliveryAppId, appOrderCode } });
          navigate('/pos/order');
        }}
      />
    </div>
  );
}

function AreaTab({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      role="tab"
      aria-selected={on}
      onClick={onClick}
      className={cn(
        'shrink-0 border-b-2 py-2.5',
        on ? 'border-primary font-semibold text-primary-ink' : 'border-transparent text-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

function Tile({
  selected,
  className,
  onClick,
  children,
}: {
  selected: boolean;
  className: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'relative flex flex-col items-center justify-center gap-1 rounded-card border p-2',
        className,
        selected && 'ring-2 ring-primary ring-offset-1',
      )}
    >
      {children}
    </button>
  );
}

const TableIcon = () => (
  <svg
    aria-hidden
    width="28"
    height="28"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
  >
    <path d="M3 10h18M5 10v9M19 10v9M7 6h10" />
  </svg>
);

const Legend = ({ className, children }: { className: string; children: React.ReactNode }) => (
  <span className="flex items-center gap-1.5">
    <span className={cn('size-3 rounded-[5px]', className)} />
    {children}
  </span>
);

function AppOrderDialog({
  open,
  onClose,
  onStart,
}: {
  open: boolean;
  onClose: () => void;
  onStart: (appId: number, code: string | null) => void;
}) {
  const apps = useDeliveryApps().data?.filter((a) => a.active) ?? [];
  const [appId, setAppId] = useState<number | null>(null);
  const [code, setCode] = useState('');
  useEffect(() => {
    if (open) {
      setAppId(null);
      setCode('');
    }
  }, [open]);
  const chosen = appId ?? apps[0]?.id ?? null;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Đơn app giao hàng"
      width={420}
      footer={
        <>
          <Button onClick={onClose}>Đóng</Button>
          <Button
            variant="primary"
            disabled={!chosen}
            onClick={() => chosen && onStart(chosen, code.trim() || null)}
          >
            Gọi món
          </Button>
        </>
      }
    >
      {apps.length === 0 ? (
        <p className="text-[13px] text-muted">
          Chưa có app giao hàng — ADMIN thêm ở Hệ thống → App giao hàng.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            {apps.map((a) => (
              <button
                key={a.id}
                onClick={() => setAppId(a.id)}
                aria-pressed={a.id === chosen}
                className={cn(
                  'h-12 rounded-ctl border text-sm font-semibold',
                  a.id === chosen
                    ? 'border-primary bg-primary-soft text-primary-ink'
                    : 'border-field bg-white',
                )}
              >
                {a.name}
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-1.5 text-[13px] font-medium">
            Mã đơn trên app (không bắt buộc)
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="VD: 8812"
              maxLength={40}
            />
          </label>
        </div>
      )}
    </Dialog>
  );
}
