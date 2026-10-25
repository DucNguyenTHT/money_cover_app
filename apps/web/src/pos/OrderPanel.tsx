import { useEffect, useState } from 'react';
import {
  ArrowLeftRight,
  BadgePercent,
  ChefHat,
  CreditCard,
  Plus,
  Printer,
  Scissors,
  StickyNote,
  Trash2,
  X,
  UserRound,
} from 'lucide-react';
import type { OrderDto, OrderItemDto } from '@ketoan/api/contracts';
import { optionsLabel } from '@ketoan/api/domain';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { client, errorMessage, HttpError, ok } from '@/lib/api-client';
import { money } from '@/lib/format';
import { cn } from '@/lib/cn';
import { usePos } from './context';
import { CHANNEL_LABEL, useFloor, useOrder, usePosSettings, useSetOrder, whereLabel, lineName } from './data';
import {
  CancelOrderDialog,
  DiscountDialog,
  ItemDialog,
  MoveDialog,
  OrderInfoDialog,
  SplitDialog,
} from './OrderDialogs';
import { PaymentDialog } from './PaymentDialog';
import { CustomerDialog } from './CustomerDialog';
import { billHtml, kitchenHtml, printHtml } from './print';

const STATE: Record<OrderItemDto['kitchenStatus'], { label: string; cls: string }> = {
  NEW: { label: 'Chưa gửi bếp', cls: 'text-warn' },
  SENT: { label: 'Đang làm', cls: 'text-primary-ink' },
  DONE: { label: 'Xong – chờ ra món', cls: 'text-good' },
  SERVED: { label: 'Đã ra món', cls: 'text-good' },
};

type Dlg = 'pay' | 'discount' | 'move' | 'split' | 'cancel' | 'info' | 'customer' | null;

/** Right-hand order panel used on the table map and the menu screen. */
export function OrderPanel({ onPaid, onClose }: { onPaid?: () => void; onClose?: () => void }) {
  const { target, setTarget, addDish, pending } = usePos();
  const orderId = target && 'orderId' in target ? target.orderId : null;
  const q = useOrder(orderId);
  const floor = useFloor();
  const setOrder = useSetOrder();
  const toast = useToast();
  const settings = usePosSettings().data?.settings;
  const [dlg, setDlg] = useState<Dlg>(null);
  const [editing, setEditing] = useState<OrderItemDto | null>(null);
  const [busy, setBusy] = useState(false);
  const order = q.data && q.data.status === 'OPEN' ? q.data : null;

  // An order closed elsewhere (paid / cancelled / merged on another till) leaves the panel.
  useEffect(() => {
    if (q.data && q.data.status !== 'OPEN') setTarget(null);
  }, [q.data, setTarget]);

  const act = async (fn: () => Promise<OrderDto>, done?: string) => {
    setBusy(true);
    try {
      const o = await fn();
      setOrder(o);
      if (done) toast(done);
      return o;
    } catch (e) {
      if (e instanceof HttpError && e.code === 'STALE_ORDER') q.refetch();
      toast(errorMessage(e), 'bad');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const sendKitchen = async () => {
    if (!order) return;
    setBusy(true);
    try {
      const r = ok(
        await client.orders.sendKitchen({ params: { id: order.id }, body: { version: order.version } }),
      );
      setOrder(r.order);
      if (r.printWarnings.length) toast(`Máy in: ${r.printWarnings[0]}`, 'bad');
      else toast('Đã gửi bếp / bar');
      if (settings?.print_mode === 'BROWSER') {
        const sent = r.order.items.filter(
          (i) => i.sentAt && order.items.find((x) => x.id === i.id)?.kitchenStatus === 'NEW',
        );
        for (const st of ['KITCHEN', 'BAR'] as const) {
          const mine = sent.filter((i) => i.station === st);
          if (mine.length) printHtml(kitchenHtml(r.order, mine, st === 'BAR' ? 'PHIẾU BAR' : 'PHIẾU BẾP'));
        }
      }
    } catch (e) {
      toast(errorMessage(e), 'bad');
    } finally {
      setBusy(false);
    }
  };

  const printProvisional = async () => {
    if (!order) return;
    try {
      const r = ok(await client.orders.print({ params: { id: order.id }, body: { kind: 'PROVISIONAL' } }));
      if (r.printed) toast('Đã in phiếu tạm tính');
      else printHtml(await billHtml(ok(await client.orders.bill({ params: { id: order.id } })), true));
      q.refetch();
    } catch (e) {
      toast(errorMessage(e), 'bad');
    }
  };

  const reprintKitchen = async () => {
    if (!order) return;
    try {
      const r = ok(await client.orders.print({ params: { id: order.id }, body: { kind: 'KITCHEN' } }));
      if (r.printed) return toast(r.message);
      // No LAN printer (or it failed): print the tickets from this browser instead.
      const sent = order.items.filter((i) => i.status === 'ACTIVE' && i.kitchenStatus !== 'NEW');
      for (const st of ['KITCHEN', 'BAR'] as const) {
        const mine = sent.filter((i) => i.station === st);
        if (mine.length)
          printHtml(kitchenHtml(order, mine, st === 'BAR' ? 'PHIẾU BAR (IN LẠI)' : 'PHIẾU BẾP (IN LẠI)'));
      }
    } catch (e) {
      toast(errorMessage(e), 'bad');
    }
  };

  // F9 thanh toán, F10 gửi bếp
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!order || dlg) return;
      if (e.key === 'F9') {
        e.preventDefault();
        setDlg('pay');
      } else if (e.key === 'F10') {
        e.preventDefault();
        sendKitchen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!target) {
    return (
      <Shell>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <p className="font-semibold text-ink-strong">Chưa chọn đơn</p>
          <p className="max-w-xs text-[13px] text-muted">
            Chọn một bàn trên sơ đồ, hoặc bấm "Mang về" / "App" để bắt đầu gọi món.
          </p>
        </div>
      </Shell>
    );
  }

  const tableId = order?.tableId ?? (target && 'draft' in target ? target.draft.tableId : null);
  const siblings = tableId
    ? (floor.data?.areas.flatMap((a) => a.tables).find((t) => t.id === tableId)?.orders ?? [])
    : [];
  const title = order
    ? whereLabel(order)
    : 'draft' in target
      ? (target.draft.tableName ?? CHANNEL_LABEL[target.draft.channel])
      : '';
  const active = order?.items.filter((i) => i.status === 'ACTIVE') ?? [];
  const cancelled = order?.items.filter((i) => i.status === 'CANCELLED') ?? [];
  const unsent = active.some((i) => i.kitchenStatus === 'NEW');
  const discount = order ? Number(order.itemDiscountTotal) + Number(order.orderDiscountAmount) : 0;

  return (
    <Shell>
      <div className="flex h-11 shrink-0 items-end gap-0.5 overflow-x-auto rounded-t-card bg-[#f2f4f7] px-2">
        {(siblings.length ? siblings : order ? [order] : []).map((s) => {
          const on = s.id === orderId;
          return (
            <button
              key={s.id}
              onClick={() => setTarget({ orderId: s.id })}
              className={cn(
                'flex h-9 shrink-0 items-center gap-2 rounded-t-[10px] px-3 text-sm',
                on ? 'bg-white font-semibold text-primary-ink' : 'text-muted',
              )}
            >
              {siblings.length > 1 ? `${whereLabel(s)} · ${s.code.slice(-3)}` : whereLabel(s)}
            </button>
          );
        })}
        {!order && (
          <span className="flex h-9 items-center rounded-t-[10px] bg-white px-3 text-sm font-semibold text-primary-ink">
            {title} · đơn mới
          </span>
        )}
        {order?.channel === 'DINE_IN' && (
          <button
            aria-label="Thêm đơn mới cùng bàn"
            title="Thêm đơn mới cùng bàn"
            onClick={() =>
              setTarget({
                draft: {
                  channel: 'DINE_IN',
                  tableId: order.tableId,
                  tableName: order.tableName ?? undefined,
                  deliveryAppId: null,
                  appOrderCode: null,
                },
              })
            }
            className="flex h-9 shrink-0 items-center px-2.5 text-primary-ink"
          >
            <Plus size={18} />
          </button>
        )}
        <div className="flex-1" />
        {onClose && (
          <button
            aria-label="Đóng"
            onClick={onClose}
            className="mb-1 flex size-9 items-center justify-center rounded-ctl text-muted hover:bg-white/70"
          >
            <X size={18} />
          </button>
        )}
      </div>

      {order ? (
        <button
          onClick={() => setDlg('info')}
          className="flex shrink-0 flex-wrap items-center gap-x-3.5 gap-y-1 border-b border-line px-3.5 py-2 text-left text-[13px] text-muted hover:bg-page"
        >
          <span>#{order.code}</span>
          <span>
            Mở {new Date(order.openedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
          </span>
          <span>{order.guestCount} khách</span>
          {order.note && <span className="max-w-[160px] truncate text-warn">“{order.note}”</span>}
          <span className="ml-auto inline-flex items-center gap-1 text-primary-ink">
            <StickyNote size={14} /> Ghi chú
          </span>
        </button>
      ) : (
        <p className="border-b border-line px-3.5 py-2 text-[13px] text-muted">
          Đơn chỉ được tạo khi gọi món đầu tiên.
        </p>
      )}
      {order?.customer && (
        <button
          onClick={() => setDlg('customer')}
          className="flex shrink-0 items-center gap-2 border-b border-line bg-primary-soft/50 px-3.5 py-1.5 text-left text-[13px] hover:bg-primary-soft"
        >
          <UserRound size={14} className="text-primary-ink" />
          <b>{order.customer.name}</b>
          <span className="text-muted">· {money(order.customer.points)} điểm</span>
        </button>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {q.isLoading && orderId ? (
          <div className="flex justify-center p-8 text-muted">
            <Spinner />
          </div>
        ) : active.length === 0 ? (
          <p className="p-8 text-center text-[13px] text-muted">Chưa có món — bấm món bên trái để thêm.</p>
        ) : (
          active.map((i, k) => (
            <Line
              key={i.id}
              no={k + 1}
              item={i}
              disabled={busy}
              onOpen={() => setEditing(i)}
              onPlus={() =>
                i.kitchenStatus === 'NEW'
                  ? act(async () =>
                      ok(
                        await client.orders.updateItem({
                          params: { id: order!.id, itemId: i.id },
                          body: { version: order!.version, qty: i.qty + 1 },
                        }),
                      ),
                    )
                  : // Sent line: one more portion as a new line, with the same options.
                    addDish(
                      i.dishId,
                      1,
                      i.options.flatMap((o) => (o.optionId === null ? [] : [o.optionId])),
                    )
              }
              onMinus={() =>
                i.kitchenStatus !== 'NEW'
                  ? setEditing(i)
                  : i.qty > 1
                    ? act(async () =>
                        ok(
                          await client.orders.updateItem({
                            params: { id: order!.id, itemId: i.id },
                            body: { version: order!.version, qty: i.qty - 1 },
                          }),
                        ),
                      )
                    : act(async () =>
                        ok(
                          await client.orders.removeItem({
                            params: { id: order!.id, itemId: i.id },
                            body: { version: order!.version },
                          }),
                        ),
                      )
              }
            />
          ))
        )}
        {cancelled.length > 0 && (
          <details className="px-3.5 py-2 text-[13px] text-muted">
            <summary className="cursor-pointer">{cancelled.length} món đã huỷ</summary>
            {cancelled.map((i) => (
              <p key={i.id} className="mt-1 line-through decoration-faint">
                {i.qty} × {lineName(i)} <span className="no-underline">— {i.cancelReason}</span>
              </p>
            ))}
          </details>
        )}
      </div>

      {order && (
        <>
          <div className="num flex shrink-0 flex-col gap-1.5 border-t border-line px-3.5 py-3">
            <div className="flex justify-between text-muted">
              <span>
                Tổng tiền hàng{' '}
                <span className="ml-1 rounded bg-track px-1.5 text-xs">
                  {active.reduce((s, i) => s + i.qty, 0)}
                </span>
              </span>
              <span>{money(order.subtotal)}</span>
            </div>
            {discount > 0 && (
              <div className="flex justify-between text-muted">
                <span className="truncate">
                  Giảm giá{order.discountReason ? ` (${order.discountReason})` : ''}
                </span>
                <span>−{money(discount)}</span>
              </div>
            )}
            {Number(order.serviceChargeAmount) > 0 && (
              <div className="flex justify-between text-muted">
                <span>Phụ thu {Number(order.serviceChargePct)}%</span>
                <span>{money(order.serviceChargeAmount)}</span>
              </div>
            )}
            {Number(order.vatAmount) > 0 && (
              <div className="flex justify-between text-muted">
                <span>
                  {order.vatMode === 'INCLUSIVE' ? 'Đã gồm VAT' : 'VAT'} {Number(order.vatPct)}%
                </span>
                <span>{money(order.vatAmount)}</span>
              </div>
            )}
            <div className="flex items-baseline justify-between">
              <span className="font-semibold">Khách cần trả</span>
              <span className="text-[22px] font-bold text-primary-ink">{money(order.total)}</span>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-1.5 px-3.5 pb-2.5">
            <ToolButton icon={<BadgePercent size={16} />} onClick={() => setDlg('discount')}>
              Giảm giá
            </ToolButton>
            <ToolButton icon={<UserRound size={16} />} onClick={() => setDlg('customer')}>
              Khách quen
            </ToolButton>
            <ToolButton icon={<ArrowLeftRight size={16} />} onClick={() => setDlg('move')}>
              Chuyển / gộp
            </ToolButton>
            <ToolButton
              icon={<Scissors size={16} />}
              onClick={() => setDlg('split')}
              disabled={active.length === 0}
            >
              Tách đơn
            </ToolButton>
            <ToolButton
              icon={<Printer size={16} />}
              onClick={printProvisional}
              disabled={active.length === 0}
            >
              Tạm tính
            </ToolButton>
            {active.some((i) => i.kitchenStatus !== 'NEW') && (
              <ToolButton icon={<ChefHat size={16} />} onClick={reprintKitchen}>
                In lại phiếu bếp
              </ToolButton>
            )}
            <ToolButton icon={<Trash2 size={16} />} onClick={() => setDlg('cancel')} danger>
              Huỷ đơn
            </ToolButton>
          </div>
        </>
      )}

      <div className="grid shrink-0 grid-cols-2 gap-2.5 px-3.5 pb-3.5">
        <Button
          variant="tonal"
          size="xl"
          icon={<ChefHat size={18} />}
          kbd="F10"
          disabled={!order || !unsent || busy}
          onClick={sendKitchen}
        >
          Gửi bếp
        </Button>
        <Button
          variant="pay"
          size="xl"
          icon={<CreditCard size={18} />}
          kbd="F9"
          disabled={!order || active.length === 0 || pending > 0}
          onClick={() => setDlg('pay')}
        >
          Thanh toán
        </Button>
      </div>

      {order && (
        <>
          <ItemDialog
            order={order}
            item={editing}
            onClose={() => setEditing(null)}
            onDone={(o) => (setOrder(o), setEditing(null))}
          />
          <DiscountDialog
            order={order}
            open={dlg === 'discount'}
            onClose={() => setDlg(null)}
            onDone={(o) => (setOrder(o), setDlg(null))}
          />
          <MoveDialog
            order={order}
            open={dlg === 'move'}
            onClose={() => setDlg(null)}
            onDone={(o) => {
              setOrder(o);
              setTarget({ orderId: o.id });
              setDlg(null);
              toast(o.id === order.id ? `Đã chuyển sang ${whereLabel(o)}` : `Đã gộp vào ${whereLabel(o)}`);
            }}
          />
          <SplitDialog
            order={order}
            open={dlg === 'split'}
            onClose={() => setDlg(null)}
            onDone={(source, created) => {
              setOrder(source);
              setOrder(created);
              setDlg(null);
              toast(`Đã tách sang đơn ${created.code}`);
            }}
          />
          <CancelOrderDialog
            order={order}
            open={dlg === 'cancel'}
            onClose={() => setDlg(null)}
            onDone={(o) => {
              setOrder(o);
              setDlg(null);
              setTarget(null);
              toast(`Đã huỷ đơn ${o.code}`);
            }}
          />
          <OrderInfoDialog
            order={order}
            open={dlg === 'info'}
            onClose={() => setDlg(null)}
            onDone={(o) => (setOrder(o), setDlg(null))}
          />
          <CustomerDialog
            order={order}
            open={dlg === 'customer'}
            onClose={() => setDlg(null)}
            onDone={(o) => (setOrder(o), setDlg(null))}
          />
          <PaymentDialog
            order={order}
            open={dlg === 'pay'}
            onClose={() => setDlg(null)}
            onPaid={(o) => {
              setOrder(o);
              setDlg(null);
              setTarget(null);
              onPaid?.();
            }}
          />
        </>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <aside className="flex h-full min-h-0 flex-col rounded-card bg-white">{children}</aside>;
}

function ToolButton({
  icon,
  children,
  danger,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: React.ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-ctl border border-field bg-white px-2.5 text-[13px] font-medium shadow-[var(--shadow-btn)] hover:bg-page disabled:opacity-50',
        danger ? 'text-bad-ink' : 'text-ink',
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

function Line({
  no,
  item,
  disabled,
  onOpen,
  onPlus,
  onMinus,
}: {
  no: number;
  item: OrderItemDto;
  disabled: boolean;
  onOpen: () => void;
  onPlus: () => void;
  onMinus: () => void;
}) {
  const st = STATE[item.kitchenStatus];
  return (
    <div className="num grid grid-cols-[20px_minmax(0,1fr)_88px_84px] items-center gap-2 border-b border-[#f2f4f7] px-3.5 py-2.5 sm:grid-cols-[20px_minmax(0,1fr)_88px_70px_84px]">
      <span className="text-[13px] text-faint">{no}.</span>
      <button onClick={onOpen} className="flex min-w-0 flex-col items-start gap-0.5 text-left">
        <span className="max-w-full truncate font-medium">{item.dishName}</span>
        {item.options.length > 0 && (
          <span className="max-w-full truncate text-xs text-ink">{optionsLabel(item.options)}</span>
        )}
        <span className="max-w-full truncate text-xs">
          <span className={st.cls}>
            {item.station === 'BAR' && item.kitchenStatus === 'SENT' ? 'Bar đang làm' : st.label}
          </span>
          {item.note && <span className="text-muted"> · {item.note}</span>}
          {Number(item.discountAmount) > 0 && (
            <span className="text-warn"> · −{money(item.discountAmount)}</span>
          )}
        </span>
      </button>
      <span className="flex h-[30px] items-center justify-center rounded-ctl border border-field">
        <button
          aria-label={`Bớt ${item.dishName}`}
          disabled={disabled}
          onClick={onMinus}
          className="h-full w-7 font-semibold text-muted"
        >
          −
        </button>
        <span className="w-6 text-center font-semibold">{item.qty}</span>
        <button
          aria-label={`Thêm ${item.dishName}`}
          disabled={disabled}
          onClick={onPlus}
          className="h-full w-7 font-semibold text-primary-ink"
        >
          +
        </button>
      </span>
      <span className="hidden text-right text-muted sm:block">{money(item.unitPrice)}</span>
      <span className="text-right font-semibold">
        {money(Number(item.amount) - Number(item.discountAmount))}
      </span>
    </div>
  );
}
