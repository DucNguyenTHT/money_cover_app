import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Layers, Plus, Trash2, X } from 'lucide-react';
import type { PromotionDto } from '@ketoan/api/contracts';
import type { Channel, PromotionKind } from '@ketoan/api/domain';
import { PageHeader } from '@/components/PageHeader';
import { DateInput } from '@/components/DateInput';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, Card, EmptyState, Segmented, Select, Switch } from '@/components/ui/controls';
import { DataTable } from '@/components/ui/DataTable';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { FormError } from '@/auth/AuthCard';
import { client, errorMessage, ok } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { dateVi, money, parseMoney } from '@/lib/format';
import { CHANNEL_LABEL } from '@/pos/data';

const DAYS = [
  [1, 'T2'],
  [2, 'T3'],
  [3, 'T4'],
  [4, 'T5'],
  [5, 'T6'],
  [6, 'T7'],
  [7, 'CN'],
] as const;
const STATUS = {
  RUNNING: <Badge tone="good">Đang chạy</Badge>,
  UPCOMING: <Badge tone="primary">Sắp chạy</Badge>,
  ENDED: <Badge>Đã hết hạn</Badge>,
  OFF: <Badge>Đang tắt</Badge>,
};

/** "T2, T3 · 14:00–17:00 · đến 30/11" */
function whenText(p: Pick<PromotionDto, 'weekdays' | 'startTime' | 'endTime' | 'startDate' | 'endDate'>) {
  const days =
    p.weekdays.length === 0 || p.weekdays.length === 7
      ? 'Mọi ngày'
      : DAYS.filter(([d]) => p.weekdays.includes(d))
          .map(([, l]) => l)
          .join(', ');
  const hours = p.startTime && p.endTime ? `${p.startTime}–${p.endTime}` : 'cả ngày';
  const dates = [
    p.startDate && `từ ${dateVi(p.startDate).slice(0, 5)}`,
    p.endDate && `đến ${dateVi(p.endDate)}`,
  ]
    .filter(Boolean)
    .join(' ');
  return [days, hours, dates].filter(Boolean).join(' · ');
}

function whatText(p: PromotionDto) {
  if (p.kind === 'COMBO')
    return `${p.items.map((i) => (i.qty > 1 ? `${i.qty} ${i.name}` : i.name)).join(' + ')} = ${money(p.comboPrice)} ₫`;
  return `−${Number(p.percent)}% ${p.items.length ? p.items.map((i) => i.name).join(', ') : 'cả thực đơn'}`;
}

/** Thực đơn › Khuyến mãi: happy hour and combos, applied to open orders by themselves. */
export function PromotionsPage() {
  const list = useQuery({
    queryKey: ['promotions'],
    queryFn: async () => ok(await client.promotions.list()),
  });
  const [editing, setEditing] = useState<PromotionDto | PromotionKind | null>(null);
  return (
    <div>
      <PageHeader
        title="Khuyến mãi"
        subtitle="Tự áp vào đơn khi gọi món: giờ vàng giảm % món, combo bán bộ món một giá. Không tính vào giới hạn giảm giá của nhân viên."
        actions={
          <>
            <Button icon={<Clock size={16} />} onClick={() => setEditing('TIME')}>
              Thêm giờ vàng
            </Button>
            <Button variant="primary" icon={<Layers size={16} />} onClick={() => setEditing('COMBO')}>
              Thêm combo
            </Button>
          </>
        }
      />
      <Card>
        <DataTable<PromotionDto>
          rows={list.data}
          loading={list.isLoading}
          rowKey={(p) => p.id}
          onRowClick={(p) => setEditing(p)}
          empty={
            <EmptyState
              title="Chưa có khuyến mãi"
              hint="VD: giờ vàng 14:00–17:00 giảm 20% đồ uống; combo Phở + Trà đá 49.000 ₫."
            />
          }
          columns={[
            {
              key: 'name',
              header: 'Khuyến mãi',
              cell: (p) => (
                <span className="flex flex-col">
                  <b className="text-ink-strong">{p.name}</b>
                  <span className="text-xs text-muted">{p.kind === 'COMBO' ? 'Combo' : 'Giờ vàng'}</span>
                </span>
              ),
            },
            {
              key: 'what',
              header: 'Ưu đãi',
              cell: (p) => <span className="text-[13px]">{whatText(p)}</span>,
            },
            {
              key: 'when',
              header: 'Thời gian',
              secondary: true,
              cell: (p) => (
                <span className="text-[13px]">
                  {whenText(p)}
                  <span className="block text-xs text-muted">
                    {p.channels.map((c) => CHANNEL_LABEL[c]).join(', ')}
                  </span>
                </span>
              ),
            },
            {
              key: 'month',
              header: 'Tháng này',
              align: 'right',
              secondary: true,
              cell: (p) => (
                <span className="num text-[13px]">
                  {p.monthOrders} đơn
                  <span className="block text-xs text-muted">−{money(p.monthAmount)} ₫</span>
                </span>
              ),
            },
            { key: 'status', header: 'Trạng thái', cell: (p) => STATUS[p.status] },
          ]}
        />
      </Card>
      {editing && (
        <PromotionForm
          promo={typeof editing === 'string' ? null : editing}
          kind={typeof editing === 'string' ? editing : editing.kind}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

type Scope = 'ALL' | 'CATEGORY' | 'DISH';
interface ComboRow {
  dishId: number;
  qty: string;
}

function PromotionForm({
  promo,
  kind,
  onClose,
}: {
  promo: PromotionDto | null;
  kind: PromotionKind;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const dishes = useQuery({
    queryKey: ['dishes'],
    queryFn: async () => ok(await client.menu.listDishes({ query: {} })),
  });
  const categories = useQuery({
    queryKey: ['dish-categories'],
    queryFn: async () => ok(await client.menu.listCategories()),
  });
  const costs = useQuery({
    queryKey: ['pricing'],
    queryFn: async () => ok(await client.pricing.list({ query: {} })),
    enabled: kind === 'COMBO',
  });

  const [name, setName] = useState(promo?.name ?? '');
  const [active, setActive] = useState(promo?.active ?? true);
  const [startDate, setStartDate] = useState(promo?.startDate ?? '');
  const [endDate, setEndDate] = useState(promo?.endDate ?? '');
  const [weekdays, setWeekdays] = useState<number[]>(promo?.weekdays ?? []);
  const [startTime, setStartTime] = useState(promo?.startTime ?? (kind === 'TIME' ? '14:00' : ''));
  const [endTime, setEndTime] = useState(promo?.endTime ?? (kind === 'TIME' ? '17:00' : ''));
  const [channels, setChannels] = useState<Channel[]>(promo?.channels ?? ['DINE_IN', 'TAKEAWAY']);
  const [percent, setPercent] = useState(promo?.percent ? String(Number(promo.percent)) : '20');
  const [scope, setScope] = useState<Scope>(
    !promo || promo.items.length === 0 ? 'ALL' : promo.items[0]!.dishId ? 'DISH' : 'CATEGORY',
  );
  const [picked, setPicked] = useState<number[]>(
    promo?.kind === 'TIME' ? promo.items.map((i) => (i.dishId ?? i.categoryId)!) : [],
  );
  const [rows, setRows] = useState<ComboRow[]>(
    promo?.kind === 'COMBO' ? promo.items.map((i) => ({ dishId: i.dishId!, qty: String(i.qty) })) : [],
  );
  const [comboPrice, setComboPrice] = useState(promo?.comboPrice ? money(promo.comboPrice) : '');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const dishList = useMemo(
    () => (dishes.data ?? []).filter((d) => d.active || rows.some((r) => r.dishId === d.id)),
    [dishes.data, rows],
  );
  const combo = useMemo(() => {
    const byId = new Map((dishes.data ?? []).map((d) => [d.id, d]));
    const costOf = new Map(
      (costs.data?.rows ?? []).map((r) => [r.dishId, Number(r.channels.DINE_IN.directCost)]),
    );
    const normal = rows.reduce(
      (s, r) => s + Number(byId.get(r.dishId)?.storePrice ?? 0) * (Number(r.qty) || 0),
      0,
    );
    const cost = rows.reduce((s, r) => s + (costOf.get(r.dishId) ?? 0) * (Number(r.qty) || 0), 0);
    const price = parseMoney(comboPrice);
    return { normal, cost, price, saving: normal - price, profit: price - cost };
  }, [rows, comboPrice, dishes.data, costs.data]);

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name,
        kind,
        active,
        startDate: startDate || null,
        endDate: endDate || null,
        weekdays: weekdays.length === 7 ? [] : weekdays,
        startTime: startTime || null,
        endTime: endTime || null,
        channels,
        percent: kind === 'TIME' ? percent.replace(',', '.') || '0' : null,
        comboPrice: kind === 'COMBO' ? String(parseMoney(comboPrice)) : null,
        items:
          kind === 'COMBO'
            ? rows.map((r) => ({ dishId: r.dishId, categoryId: null, qty: Number(r.qty) || 1 }))
            : scope === 'ALL'
              ? []
              : picked.map((id) => ({
                  dishId: scope === 'DISH' ? id : null,
                  categoryId: scope === 'CATEGORY' ? id : null,
                  qty: 1,
                })),
      };
      return promo
        ? ok(await client.promotions.update({ params: { id: promo.id }, body }))
        : ok(await client.promotions.create({ body }));
    },
    onSuccess: () => {
      toast('Đã lưu khuyến mãi — đơn đang mở được tính lại');
      qc.invalidateQueries({ queryKey: ['promotions'] });
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: async () => ok(await client.promotions.remove({ params: { id: promo!.id }, body: {} })),
    onSuccess: () => {
      toast('Đã xoá khuyến mãi');
      qc.invalidateQueries({ queryKey: ['promotions'] });
      onClose();
    },
  });
  const error = save.error ?? remove.error;

  return (
    <Dialog
      open
      onClose={onClose}
      title={promo ? `Sửa ${promo.name}` : kind === 'COMBO' ? 'Thêm combo' : 'Thêm giờ vàng'}
      width={640}
      footer={
        <>
          {promo && (
            <Button
              className="mr-auto"
              variant={confirmDelete ? 'danger' : 'ghost'}
              icon={<Trash2 size={16} />}
              loading={remove.isPending}
              onClick={() => (confirmDelete ? remove.mutate() : setConfirmDelete(true))}
            >
              {confirmDelete ? 'Bấm lần nữa để xoá' : 'Xoá'}
            </Button>
          )}
          <Button onClick={onClose}>Huỷ bỏ</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!name.trim()}
            onClick={() => save.mutate()}
          >
            Lưu
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <Field label="Tên (in trên bill)">
            {(id) => (
              <Input
                id={id}
                value={name}
                placeholder={kind === 'COMBO' ? 'VD: Combo trưa' : 'VD: Giờ vàng đồ uống'}
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </Field>
          <Switch checked={active} onChange={setActive} label="Đang bật" />
        </div>

        {kind === 'TIME' ? (
          <>
            <div className="grid gap-4 sm:grid-cols-[120px_minmax(0,1fr)] sm:items-end">
              <Field label="Giảm (%)">
                {(id) => (
                  <Input
                    id={id}
                    inputMode="decimal"
                    className="num text-right"
                    value={percent}
                    onChange={(e) => setPercent(e.target.value)}
                  />
                )}
              </Field>
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium">Áp dụng cho</span>
                <Segmented
                  label="Áp dụng cho"
                  value={scope}
                  onChange={(v) => (setScope(v), setPicked([]))}
                  options={[
                    { value: 'ALL', label: 'Cả thực đơn' },
                    { value: 'CATEGORY', label: 'Nhóm món' },
                    { value: 'DISH', label: 'Món' },
                  ]}
                />
              </div>
            </div>
            {scope !== 'ALL' && (
              <div className="flex max-h-44 flex-wrap gap-2 overflow-y-auto rounded-ctl border border-line-soft p-2">
                {(scope === 'CATEGORY'
                  ? (categories.data ?? []).map((c) => ({ id: c.id, name: c.name }))
                  : dishList.map((d) => ({ id: d.id, name: d.name }))
                ).map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    aria-pressed={picked.includes(x.id)}
                    onClick={() => setPicked(toggle(picked, x.id))}
                    className={cn(
                      'rounded-full border px-3 py-1 text-[13px]',
                      picked.includes(x.id)
                        ? 'border-primary bg-primary-soft font-medium text-primary-ink'
                        : 'border-line bg-white text-ink hover:bg-page',
                    )}
                  >
                    {x.name}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-medium">Món trong một bộ</span>
              {rows.map((r, k) => (
                <div key={k} className="grid grid-cols-[minmax(0,1fr)_72px_36px] items-center gap-2">
                  <Select
                    aria-label={`Món ${k + 1}`}
                    value={String(r.dishId)}
                    onChange={(e) =>
                      setRows(rows.map((x, j) => (j === k ? { ...x, dishId: Number(e.target.value) } : x)))
                    }
                  >
                    {dishList.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} {d.storePrice ? `— ${money(d.storePrice)}` : ''}
                      </option>
                    ))}
                  </Select>
                  <Input
                    aria-label={`Số phần món ${k + 1}`}
                    inputMode="numeric"
                    className="num text-right"
                    value={r.qty}
                    onChange={(e) =>
                      setRows(
                        rows.map((x, j) => (j === k ? { ...x, qty: e.target.value.replace(/\D/g, '') } : x)),
                      )
                    }
                  />
                  <IconButton
                    label="Bỏ món"
                    size={34}
                    onClick={() => setRows(rows.filter((_, j) => j !== k))}
                  >
                    <X size={16} />
                  </IconButton>
                </div>
              ))}
              <div>
                <Button
                  size="sm"
                  icon={<Plus size={14} />}
                  disabled={!dishList.length}
                  onClick={() =>
                    setRows([
                      ...rows,
                      {
                        dishId: (dishList.find((d) => !rows.some((r) => r.dishId === d.id)) ?? dishList[0]!)
                          .id,
                        qty: '1',
                      },
                    ])
                  }
                >
                  Thêm món
                </Button>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-end">
              <Field label="Giá combo (₫)">
                {(id) => (
                  <Input
                    id={id}
                    inputMode="numeric"
                    className="num text-right"
                    value={comboPrice}
                    onChange={(e) => setComboPrice(e.target.value)}
                    onBlur={() => comboPrice && setComboPrice(money(parseMoney(comboPrice)))}
                  />
                )}
              </Field>
              {rows.length > 0 && (
                <p className="num text-[13px] text-muted">
                  Giá lẻ {money(combo.normal)} ₫
                  {combo.price > 0 && (
                    <>
                      {' · '}
                      <span className={combo.saving > 0 ? 'text-good' : 'text-bad'}>
                        khách {combo.saving > 0 ? 'được giảm' : 'trả thêm'} {money(Math.abs(combo.saving))} ₫
                      </span>
                      {' · '}giá vốn {money(combo.cost)} ₫ · lãi gộp{' '}
                      <span className={combo.profit > 0 ? '' : 'font-semibold text-bad'}>
                        {money(combo.profit)} ₫ ({Math.round((combo.profit * 100) / combo.price)}%)
                      </span>
                    </>
                  )}
                </p>
              )}
            </div>
            <p className="text-xs text-faint">
              Đơn có đủ món của bộ thì tự tính giá combo (đủ 2 bộ tính 2 lần). Tuỳ chọn / topping vẫn cộng
              thêm.
            </p>
          </>
        )}

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-[13px] font-medium">Thứ trong tuần (không chọn = mọi ngày)</legend>
          <div className="flex flex-wrap gap-2">
            {DAYS.map(([d, l]) => (
              <button
                key={d}
                type="button"
                aria-pressed={weekdays.includes(d)}
                onClick={() => setWeekdays(toggle(weekdays, d).sort())}
                className={cn(
                  'h-9 w-11 rounded-ctl border text-[13px] font-medium',
                  weekdays.includes(d)
                    ? 'border-primary bg-primary-soft text-primary-ink'
                    : 'border-line bg-white',
                )}
              >
                {l}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Từ giờ" hint="Trống = cả ngày">
            {(id, d) => (
              <Input
                id={id}
                aria-describedby={d}
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            )}
          </Field>
          <Field label="Đến giờ">
            {(id) => (
              <Input id={id} type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            )}
          </Field>
          <Field label="Từ ngày">
            {() => <DateInput aria-label="Từ ngày" value={startDate} onChange={setStartDate} />}
          </Field>
          <Field label="Đến ngày">
            {() => <DateInput aria-label="Đến ngày" value={endDate} onChange={setEndDate} />}
          </Field>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-[13px] font-medium">Kênh bán</legend>
          <div className="flex flex-wrap gap-4">
            {(Object.keys(CHANNEL_LABEL) as Channel[]).map((c) => (
              <label key={c} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--color-primary)]"
                  checked={channels.includes(c)}
                  onChange={() => setChannels(toggle(channels, c))}
                />
                {CHANNEL_LABEL[c]}
              </label>
            ))}
          </div>
          {channels.includes('APP') && (
            <p className="text-xs text-warn">
              Đơn app đã có giá riêng và bị app thu chiết khấu — cân nhắc trước khi bật.
            </p>
          )}
        </fieldset>
        <p className="text-xs text-faint">
          Giờ tính theo lúc gọi món; thứ / ngày theo ngày kinh doanh. Món đã giảm giá tay không được khuyến
          mãi thêm.
        </p>
        <FormError message={error ? errorMessage(error) : null} />
      </div>
    </Dialog>
  );
}
