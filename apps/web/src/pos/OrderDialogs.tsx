import { useEffect, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import type { OrderDto, OrderItemDto } from '@ketoan/api/contracts';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Segmented } from '@/components/ui/controls';
import { FormError } from '@/auth/AuthCard';
import { client, errorMessage, ok } from '@/lib/api-client';
import { money } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useWithApproval } from './Approval';
import { dishGroups, lineName, useFloor, useMenu, useOptionGroups, whereLabel } from './data';
import { OptionChooser } from './OptionPicker';
import { resolveOptions } from '@ketoan/api/domain';

type Done = (o: OrderDto) => void;
const digits = (v: string) => v.replace(/\D/g, '');

/** Shared footer/submit plumbing: busy flag + error text. */
function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

export function Stepper({
  value,
  min,
  max,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  label: string;
}) {
  return (
    <span
      className="inline-flex h-9 items-center rounded-ctl border border-field bg-white"
      role="group"
      aria-label={label}
    >
      <button
        type="button"
        aria-label="Giảm"
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
        className="flex h-full w-9 items-center justify-center text-muted disabled:opacity-40"
      >
        <Minus size={16} />
      </button>
      <span className="num w-8 text-center font-semibold">{value}</span>
      <button
        type="button"
        aria-label="Tăng"
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
        className="flex h-full w-9 items-center justify-center text-primary-ink disabled:opacity-40"
      >
        <Plus size={16} />
      </button>
    </span>
  );
}

const ReasonBox = ({
  value,
  onChange,
  label = 'Lý do',
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  placeholder?: string;
}) => (
  <label className="flex flex-col gap-1.5 text-[13px] font-medium">
    {label}
    <textarea
      rows={2}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-ctl border border-field px-3 py-2 text-sm font-normal focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15"
    />
  </label>
);

const Chips = ({ options, onPick }: { options: string[]; onPick: (v: string) => void }) => (
  <div className="flex flex-wrap gap-1.5">
    {options.map((o) => (
      <button
        key={o}
        type="button"
        onClick={() => onPick(o)}
        className="h-8 rounded-full border border-field bg-white px-3 text-[13px] hover:bg-page"
      >
        {o}
      </button>
    ))}
  </div>
);

// ---------------------------------------------------------------- one line

export function ItemDialog({
  order,
  item,
  onClose,
  onDone,
}: {
  order: OrderDto;
  item: OrderItemDto | null;
  onClose: () => void;
  onDone: Done;
}) {
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  const [optIds, setOptIds] = useState<number[]>([]);
  const [disc, setDisc] = useState('');
  const [discReason, setDiscReason] = useState('');
  const [cancelMode, setCancelMode] = useState(false);
  const [cancelQty, setCancelQty] = useState(1);
  const [wasted, setWasted] = useState(false);
  const [reason, setReason] = useState('');
  const { busy, error, setError, run } = useSubmit();
  const withApproval = useWithApproval();
  const menu = useMenu(order.channel);
  const optionGroups = useOptionGroups();
  const groups = item
    ? dishGroups(optionGroups.data, menu.data?.find((d) => d.id === item.dishId)?.optionGroupIds ?? [])
    : [];

  useEffect(() => {
    if (!item) return;
    setQty(item.qty);
    setNote(item.note ?? '');
    setOptIds(item.options.flatMap((o) => (o.optionId === null ? [] : [o.optionId])));
    setDisc(Number(item.discountAmount) ? String(Number(item.discountAmount)) : '');
    setDiscReason(item.discountReason ?? '');
    setCancelMode(false);
    setCancelQty(item.qty);
    setWasted(item.kitchenStatus === 'DONE' || item.kitchenStatus === 'SERVED');
    setReason('');
    setError(null);
  }, [item, setError]);

  if (!item) return null;
  const fresh = item.kitchenStatus === 'NEW';
  // Options can still change before the kitchen gets the line; the price follows.
  const chosen = resolveOptions(groups, optIds);
  const keyOf = (ids: number[]) => [...ids].sort((a, b) => a - b).join(',');
  const optionsChanged =
    fresh &&
    groups.length > 0 &&
    keyOf(optIds) !== keyOf(item.options.flatMap((o) => (o.optionId === null ? [] : [o.optionId])));
  const unitPrice =
    optionsChanged && !('error' in chosen)
      ? Number(item.basePrice) + chosen.price.toNumber()
      : Number(item.unitPrice);
  const lineAmount = unitPrice * qty;

  const save = () =>
    run(async () => {
      const o = await withApproval(async (approval) =>
        ok(
          await client.orders.updateItem({
            params: { id: order.id, itemId: item.id },
            body: {
              version: order.version,
              ...(fresh ? { qty, note: note.trim() || null } : {}),
              ...(optionsChanged ? { optionIds: optIds } : {}),
              discountAmount: disc || '0',
              discountReason: Number(disc) > 0 ? discReason.trim() : null,
              approval,
            },
          }),
        ),
      );
      if (o) onDone(o);
    });

  const remove = () =>
    run(async () =>
      onDone(
        ok(
          await client.orders.removeItem({
            params: { id: order.id, itemId: item.id },
            body: { version: order.version },
          }),
        ),
      ),
    );

  const cancel = () =>
    run(async () =>
      onDone(
        ok(
          await client.orders.cancelItem({
            params: { id: order.id, itemId: item.id },
            body: { version: order.version, qty: cancelQty, reason: reason.trim(), wasted },
          }),
        ),
      ),
    );

  return (
    <Dialog
      open
      onClose={onClose}
      title={lineName(item)}
      width={460}
      footer={
        cancelMode ? (
          <>
            <Button onClick={() => setCancelMode(false)}>Quay lại</Button>
            <Button variant="danger" loading={busy} disabled={reason.trim().length < 5} onClick={cancel}>
              Huỷ {cancelQty} món
            </Button>
          </>
        ) : (
          <>
            {fresh ? (
              <Button variant="danger" className="mr-auto" onClick={remove} loading={busy}>
                Xoá món
              </Button>
            ) : (
              <Button variant="danger" className="mr-auto" onClick={() => setCancelMode(true)}>
                Huỷ món
              </Button>
            )}
            <Button onClick={onClose}>Đóng</Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={(Number(disc) > 0 && !discReason.trim()) || (optionsChanged && 'error' in chosen)}
              onClick={save}
            >
              Lưu
            </Button>
          </>
        )
      }
    >
      {cancelMode ? (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-muted">
            Món đã gửi bếp nên chỉ huỷ được, có ghi lý do. Món đã chế biến sẽ được trừ kho như hàng huỷ.
          </p>
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium">Số lượng huỷ</span>
            <Stepper label="Số lượng huỷ" value={cancelQty} min={1} max={item.qty} onChange={setCancelQty} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={wasted}
              onChange={(e) => setWasted(e.target.checked)}
              className="size-4 accent-primary"
            />
            Bếp đã chế biến (trừ nguyên liệu vào hàng huỷ)
          </label>
          <Chips
            options={['Khách đổi món', 'Khách không ăn nữa', 'Lên nhầm món', 'Món bị lỗi']}
            onPick={setReason}
          />
          <ReasonBox value={reason} onChange={setReason} label="Lý do huỷ (tối thiểu 5 ký tự)" />
          <FormError message={error} />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-muted">
              {money(unitPrice)} × {qty} = <b className="num text-ink">{money(lineAmount)}</b>
            </span>
            {fresh ? (
              <Stepper label="Số lượng" value={qty} min={1} max={999} onChange={setQty} />
            ) : (
              <span className="text-[13px] text-muted">Đã gửi bếp · SL {item.qty}</span>
            )}
          </div>
          {fresh && groups.length > 0 && (
            <>
              <OptionChooser groups={groups} value={optIds} onChange={setOptIds} />
              {'error' in chosen && <FormError message={chosen.error} />}
            </>
          )}
          {!fresh && item.options.length > 0 && (
            <p className="text-[13px] text-muted">
              Tuỳ chọn: {item.options.map((o) => o.name).join(', ')} (đã gửi bếp, không đổi được)
            </p>
          )}
          {fresh && (
            <label className="flex flex-col gap-1.5 text-[13px] font-medium">
              Ghi chú cho bếp
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ít cay, không hành…"
                maxLength={120}
              />
              <Chips
                options={['Ít cay', 'Không hành', 'Thêm rau', 'Không đá', 'Để riêng nước']}
                onPick={(v) => setNote((n) => (n ? `${n}, ${v}` : v))}
              />
            </label>
          )}
          <div className="grid grid-cols-[140px_minmax(0,1fr)] items-end gap-2">
            <label className="flex flex-col gap-1.5 text-[13px] font-medium">
              Giảm giá món (đ)
              <Input
                inputMode="numeric"
                className="num text-right"
                value={disc ? money(disc) : ''}
                onChange={(e) => setDisc(digits(e.target.value))}
                placeholder="0"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-[13px] font-medium">
              Lý do giảm
              <Input
                value={discReason}
                onChange={(e) => setDiscReason(e.target.value)}
                disabled={!Number(disc)}
              />
            </label>
          </div>
          <FormError message={error} />
        </div>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------- order discount

export function DiscountDialog({
  order,
  open,
  onClose,
  onDone,
}: {
  order: OrderDto;
  open: boolean;
  onClose: () => void;
  onDone: Done;
}) {
  const [type, setType] = useState<'PERCENT' | 'AMOUNT'>('PERCENT');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const { busy, error, setError, run } = useSubmit();
  const withApproval = useWithApproval();

  useEffect(() => {
    if (!open) return;
    setType(order.orderDiscountType ?? 'PERCENT');
    setValue(order.orderDiscountValue ? String(Number(order.orderDiscountValue)) : '');
    setReason(order.discountReason ?? '');
    setError(null);
  }, [open, order.orderDiscountType, order.orderDiscountValue, order.discountReason, setError]);

  const send = (clear: boolean) =>
    run(async () => {
      const o = await withApproval(async (approval) =>
        ok(
          await client.orders.discount({
            params: { id: order.id },
            body: {
              version: order.version,
              type: clear ? null : type,
              value: clear ? '0' : value || '0',
              reason: clear ? null : reason.trim(),
              approval,
            },
          }),
        ),
      );
      if (o) onDone(o);
    });

  const base = Number(order.subtotal) - Number(order.itemDiscountTotal) - Number(order.promoDiscountTotal);
  const preview =
    type === 'PERCENT'
      ? Math.round((base * Math.min(Number(value) || 0, 100)) / 100)
      : Math.min(Number(value) || 0, base);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Giảm giá cả đơn"
      width={440}
      footer={
        <>
          {order.orderDiscountType && (
            <Button variant="danger" className="mr-auto" loading={busy} onClick={() => send(true)}>
              Bỏ giảm giá
            </Button>
          )}
          <Button onClick={onClose}>Đóng</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!Number(value) || !reason.trim()}
            onClick={() => send(false)}
          >
            Áp dụng
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Segmented
            label="Kiểu giảm"
            value={type}
            onChange={(v) => {
              setType(v);
              setValue('');
            }}
            options={[
              { value: 'PERCENT', label: 'Theo %' },
              { value: 'AMOUNT', label: 'Số tiền' },
            ]}
          />
          <Input
            aria-label="Mức giảm"
            inputMode="numeric"
            className="num text-right text-base font-semibold"
            value={type === 'AMOUNT' && value ? money(value) : value}
            onChange={(e) =>
              setValue(type === 'PERCENT' ? e.target.value.replace(/[^\d.]/g, '') : digits(e.target.value))
            }
            placeholder={type === 'PERCENT' ? '%' : 'đ'}
          />
        </div>
        {type === 'PERCENT' && <Chips options={['5', '10', '15', '20']} onPick={setValue} />}
        <p className="text-[13px] text-muted">
          Giảm <b className="num text-ink">{money(preview)}</b> trên {money(base)}
        </p>
        <Chips options={['Khách quen', 'Khai trương', 'Món ra chậm', 'Khuyến mãi']} onPick={setReason} />
        <ReasonBox value={reason} onChange={setReason} label="Lý do giảm giá" />
        <p className="text-xs text-faint">Vượt mức giảm tối đa trong Cài đặt sẽ cần ADMIN nhập mã PIN.</p>
        <FormError message={error} />
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- move / merge

export function MoveDialog({
  order,
  open,
  onClose,
  onDone,
}: {
  order: OrderDto;
  open: boolean;
  onClose: () => void;
  onDone: Done;
}) {
  const floor = useFloor();
  const [mode, setMode] = useState<'move' | 'merge'>(order.channel === 'DINE_IN' ? 'move' : 'merge');
  const { busy, error, run } = useSubmit();
  const tables = floor.data?.areas.flatMap((a) => a.tables.map((t) => ({ ...t, area: a.name }))) ?? [];
  const others = [...tables.flatMap((t) => t.orders), ...(floor.data?.others ?? [])].filter(
    (o) => o.id !== order.id,
  );

  const move = (tableId: number) =>
    run(async () =>
      onDone(
        ok(await client.orders.move({ params: { id: order.id }, body: { version: order.version, tableId } })),
      ),
    );
  const merge = (targetOrderId: number) =>
    run(async () =>
      onDone(
        ok(
          await client.orders.merge({
            params: { id: order.id },
            body: { version: order.version, targetOrderId },
          }),
        ),
      ),
    );

  return (
    <Dialog open={open} onClose={onClose} title="Chuyển bàn / gộp đơn" width={620}>
      <div className="flex flex-col gap-3">
        {order.channel === 'DINE_IN' && (
          <Segmented
            label="Thao tác"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'move', label: 'Chuyển sang bàn' },
              { value: 'merge', label: 'Gộp vào đơn khác' },
            ]}
          />
        )}
        {mode === 'move' ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {tables.map((t) => (
              <button
                key={t.id}
                disabled={busy || t.id === order.tableId}
                onClick={() => move(t.id)}
                className={cn(
                  'flex h-16 flex-col items-center justify-center rounded-ctl border text-sm font-semibold disabled:opacity-40',
                  t.orders.length ? 'border-[#c7dbfb] bg-[#e3eefd] text-[#1f4fa0]' : 'border-line bg-white',
                )}
              >
                {t.name}
                <span className="text-[11px] font-normal">{t.orders.length ? 'Có khách' : 'Trống'}</span>
              </button>
            ))}
          </div>
        ) : others.length === 0 ? (
          <p className="text-[13px] text-muted">Không có đơn đang mở nào khác.</p>
        ) : (
          <div className="flex flex-col divide-y divide-line-soft rounded-ctl border border-line-soft">
            {others.map((o) => (
              <button
                key={o.id}
                disabled={busy}
                onClick={() => merge(o.id)}
                className="flex items-center justify-between px-3 py-2.5 text-left hover:bg-page"
              >
                <span>
                  <b>{whereLabel(o)}</b> <span className="text-[13px] text-muted">· {o.code}</span>
                </span>
                <span className="num font-semibold">{money(o.total)}</span>
              </button>
            ))}
          </div>
        )}
        <FormError message={error} />
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- split

export function SplitDialog({
  order,
  open,
  onClose,
  onDone,
}: {
  order: OrderDto;
  open: boolean;
  onClose: () => void;
  onDone: (source: OrderDto, created: OrderDto) => void;
}) {
  const floor = useFloor();
  const [picked, setPicked] = useState<Record<number, number>>({});
  const [tableId, setTableId] = useState<number | null>(null);
  const { busy, error, setError, run } = useSubmit();
  const active = order.items.filter((i) => i.status === 'ACTIVE');

  useEffect(() => {
    if (open) {
      setPicked({});
      setTableId(null);
      setError(null);
    }
  }, [open, setError]);

  const lines = Object.entries(picked)
    .filter(([, q]) => q > 0)
    .map(([itemId, qty]) => ({ itemId: Number(itemId), qty }));
  const movedValue = lines.reduce(
    (s, l) => s + Number(active.find((i) => i.id === l.itemId)!.unitPrice) * l.qty,
    0,
  );
  const tables = floor.data?.areas.flatMap((a) => a.tables) ?? [];

  const submit = () =>
    run(async () => {
      const r = ok(
        await client.orders.split({
          params: { id: order.id },
          body: { version: order.version, lines, tableId },
        }),
      );
      onDone(r.source, r.created);
    });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Tách đơn"
      width={560}
      footer={
        <>
          <span className="mr-auto self-center text-[13px] text-muted">
            Chuyển <b className="num text-ink">{money(movedValue)}</b> sang đơn mới
          </span>
          <Button onClick={onClose}>Đóng</Button>
          <Button variant="primary" loading={busy} disabled={!lines.length} onClick={submit}>
            Tách đơn
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-muted">
          Chọn số lượng từng món chuyển sang đơn mới. Mỗi đơn thanh toán riêng.
        </p>
        <div className="flex flex-col divide-y divide-line-soft rounded-ctl border border-line-soft">
          {active.map((i) => (
            <div key={i.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0">
                <span className="font-medium">{lineName(i)}</span>
                <span className="block text-xs text-muted">
                  {i.qty} × {money(i.unitPrice)}
                </span>
              </span>
              <Stepper
                label={`Tách ${lineName(i)}`}
                value={picked[i.id] ?? 0}
                min={0}
                max={i.qty}
                onChange={(v) => setPicked((p) => ({ ...p, [i.id]: v }))}
              />
            </div>
          ))}
        </div>
        {order.channel === 'DINE_IN' && (
          <label className="flex flex-col gap-1.5 text-[13px] font-medium">
            Đơn mới ở
            <select
              value={tableId ?? ''}
              onChange={(e) => setTableId(e.target.value ? Number(e.target.value) : null)}
              className="h-10 rounded-ctl border border-field bg-white px-3 text-sm font-normal"
            >
              <option value="">Cùng bàn ({order.tableName})</option>
              {tables
                .filter((t) => t.id !== order.tableId)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.orders.length ? ' (có khách)' : ''}
                  </option>
                ))}
            </select>
          </label>
        )}
        <FormError message={error} />
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- cancel the order

export function CancelOrderDialog({
  order,
  open,
  onClose,
  onDone,
}: {
  order: OrderDto;
  open: boolean;
  onClose: () => void;
  onDone: Done;
}) {
  const [reason, setReason] = useState('');
  const [wasted, setWasted] = useState<number[]>([]);
  const { busy, error, setError, run } = useSubmit();
  const withApproval = useWithApproval();
  const cooked = order.items.filter((i) => i.status === 'ACTIVE' && i.kitchenStatus !== 'NEW');

  useEffect(() => {
    if (open) {
      setReason('');
      setWasted(cooked.filter((i) => i.kitchenStatus !== 'SENT').map((i) => i.id));
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = () =>
    run(async () => {
      const o = await withApproval(async (approval) =>
        ok(
          await client.orders.cancel({
            params: { id: order.id },
            body: { reason: reason.trim(), wastedItemIds: wasted, approval },
          }),
        ),
      );
      if (o) onDone(o);
    });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Huỷ đơn ${order.code}`}
      width={480}
      footer={
        <>
          <Button onClick={onClose}>Đóng</Button>
          <Button variant="danger" loading={busy} disabled={reason.trim().length < 5} onClick={submit}>
            Huỷ đơn
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-muted">
          Đơn không bị xoá: chuyển sang "Đã huỷ" và lưu lý do.
          {order.status === 'PAID' &&
            ' Nguyên liệu đã trừ sẽ được hoàn lại kho (trừ món đã chế biến bên dưới).'}
        </p>
        {cooked.length > 0 && (
          <fieldset className="flex flex-col gap-1.5 rounded-ctl border border-line-soft p-3">
            <legend className="px-1 text-[13px] font-medium">
              Món bếp đã chế biến (trừ kho như hàng huỷ)
            </legend>
            {cooked.map((i) => (
              <label key={i.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={wasted.includes(i.id)}
                  onChange={(e) =>
                    setWasted((w) => (e.target.checked ? [...w, i.id] : w.filter((x) => x !== i.id)))
                  }
                />
                {i.qty} × {lineName(i)}
              </label>
            ))}
          </fieldset>
        )}
        <Chips
          options={['Khách bỏ về', 'Nhập nhầm đơn', 'Khách đổi ý', 'Tạo lại đơn khác']}
          onPick={setReason}
        />
        <ReasonBox value={reason} onChange={setReason} label="Lý do huỷ (tối thiểu 5 ký tự)" />
        <FormError message={error} />
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- guests / note

export function OrderInfoDialog({
  order,
  open,
  onClose,
  onDone,
}: {
  order: OrderDto;
  open: boolean;
  onClose: () => void;
  onDone: Done;
}) {
  const [guests, setGuests] = useState(order.guestCount);
  const [note, setNote] = useState(order.note ?? '');
  const [appCode, setAppCode] = useState(order.appOrderCode ?? '');
  const { busy, error, run } = useSubmit();

  useEffect(() => {
    if (open) {
      setGuests(order.guestCount);
      setNote(order.note ?? '');
      setAppCode(order.appOrderCode ?? '');
    }
  }, [open, order.guestCount, order.note, order.appOrderCode]);

  const submit = () =>
    run(async () =>
      onDone(
        ok(
          await client.orders.update({
            params: { id: order.id },
            body: {
              version: order.version,
              guestCount: guests,
              note: note.trim() || null,
              ...(order.channel === 'APP' ? { appOrderCode: appCode.trim() || null } : {}),
            },
          }),
        ),
      ),
    );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Thông tin đơn"
      width={420}
      footer={
        <>
          <Button onClick={onClose}>Đóng</Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-medium">Số khách</span>
          <Stepper label="Số khách" value={guests} min={1} max={200} onChange={setGuests} />
        </div>
        {order.channel === 'APP' && (
          <label className="flex flex-col gap-1.5 text-[13px] font-medium">
            Mã đơn trên app
            <Input value={appCode} onChange={(e) => setAppCode(e.target.value)} maxLength={40} />
          </label>
        )}
        <ReasonBox value={note} onChange={setNote} label="Ghi chú đơn (in trên phiếu bếp)" />
        <FormError message={error} />
      </div>
    </Dialog>
  );
}
