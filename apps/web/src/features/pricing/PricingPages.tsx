import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import type { ChannelCostDto, PricingRow } from '@ketoan/api/contracts';
import { D, suggestAppPrice, suggestStorePrice, type Channel } from '@ketoan/api/domain';
import { PageHeader } from '@/components/PageHeader';
import { today } from '@/components/MonthPicker';
import { Button } from '@/components/ui/Button';
import { Badge, Card, EmptyState, Select } from '@/components/ui/controls';
import { DataTable } from '@/components/ui/DataTable';
import { Field, Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { client, errorMessage, ok } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { money, parseMoney } from '@/lib/format';

const CH: { key: Channel; label: string }[] = [
  { key: 'DINE_IN', label: 'Tại quán' },
  { key: 'TAKEAWAY', label: 'Mang về' },
  { key: 'APP', label: 'App giao hàng' },
];
const pctText = (v: string | null) => (v == null ? '—' : `${v.replace('-', '−').replace('.', ',')}%`);

/** Re-price one channel locally (no save): what-if for a typed price. */
function simulate(c: ChannelCostDto, price: number, overheadPct: string, commissionPct: string) {
  const p = D(price);
  const commission = c.channel === 'APP' ? p.mul(commissionPct).div(100).toDecimalPlaces(0) : D(0);
  const overhead = p.mul(overheadPct).div(100).toDecimalPlaces(0);
  const total = D(c.directCost).add(commission).add(overhead);
  return {
    ...c,
    price: p.toString(),
    commission: commission.toString(),
    overhead: overhead.toString(),
    totalCost: total.toString(),
    profit: p.sub(total).toString(),
    profitPct: p.isZero() ? null : p.sub(total).div(p).mul(100).toDecimalPlaces(1).toString(),
    foodCostPct: p.isZero() ? null : D(c.directCost).div(p).mul(100).toDecimalPlaces(1).toString(),
  };
}

export function CostSheetPage() {
  const [params, setParams] = useSearchParams();
  const dishId = params.get('dish') ? Number(params.get('dish')) : null;
  const [appId, setAppId] = useState<number | undefined>();
  const [tryStore, setTryStore] = useState('');
  const [tryApp, setTryApp] = useState('');
  const [target, setTarget] = useState('');
  const list = useQuery({
    queryKey: ['pricing', appId],
    queryFn: async () => ok(await client.pricing.list({ query: { appId } })),
  });
  const apps = useQuery({
    queryKey: ['delivery-apps'],
    queryFn: async () => ok(await client.venue.listDeliveryApps()),
  });
  const detail = useQuery({
    queryKey: ['pricing-detail', dishId, appId],
    enabled: dishId !== null,
    queryFn: async () => ok(await client.pricing.detail({ params: { id: dishId! }, query: { appId } })),
  });
  const row = detail.data?.row;
  const ctx = detail.data?.context ?? list.data?.context;
  const commission = ctx?.app?.commissionPct ?? '0';

  const channels = useMemo(() => {
    if (!row || !ctx) return null;
    const s = parseMoney(tryStore);
    const a = parseMoney(tryApp);
    return {
      DINE_IN: Number.isNaN(s)
        ? row.channels.DINE_IN
        : simulate(row.channels.DINE_IN, s, ctx.overheadPct, commission),
      TAKEAWAY: Number.isNaN(s)
        ? row.channels.TAKEAWAY
        : simulate(row.channels.TAKEAWAY, s, ctx.overheadPct, commission),
      APP: Number.isNaN(a) ? row.channels.APP : simulate(row.channels.APP, a, ctx.overheadPct, commission),
    };
  }, [row, ctx, tryStore, tryApp, commission]);

  const sugg = useMemo(() => {
    if (!row || !ctx) return null;
    const t = target.trim() ? target.replace(',', '.') : row.targetPct;
    const store = suggestStorePrice(row.channels.DINE_IN.directCost, t, 1000);
    const base = Number.isNaN(parseMoney(tryStore))
      ? (row.channels.DINE_IN.price ?? store?.toString())
      : String(parseMoney(tryStore));
    const app = base
      ? suggestAppPrice({
          storePrice: base,
          storeDirect: row.channels.DINE_IN.directCost,
          appDirect: row.channels.APP.directCost,
          overheadPct: ctx.overheadPct,
          commissionPct: commission,
          step: 1000,
        })
      : null;
    return { store: store?.toString() ?? null, app: app?.toString() ?? null, target: t };
  }, [row, ctx, target, tryStore, commission]);

  const rows: { label: string; key: keyof ChannelCostDto; strong?: boolean; neg?: boolean; pct?: boolean }[] =
    [
      { label: 'Giá bán', key: 'price', strong: true },
      { label: 'Nguyên liệu', key: 'ingredientCost' },
      { label: 'Bao bì', key: 'packagingCost' },
      { label: 'Giá vốn trực tiếp', key: 'directCost', strong: true },
      {
        label: `Chiết khấu app${ctx?.app ? ` (${ctx.app.name} ${Number(ctx.app.commissionPct)}%)` : ''}`,
        key: 'commission',
      },
      { label: `Chi phí chung (${(ctx?.overheadPct ?? '0').replace('.', ',')}% giá bán)`, key: 'overhead' },
      { label: 'Tổng chi phí', key: 'totalCost', strong: true },
      { label: 'Lãi ròng / phần', key: 'profit', strong: true, neg: true },
      { label: '% lãi ròng', key: 'profitPct', pct: true },
      { label: '% nguyên liệu / giá bán', key: 'foodCostPct', pct: true },
    ];

  return (
    <div>
      <PageHeader
        title="Bảng tính giá món"
        subtitle="Giá vốn theo định mức hiện hành × giá nhập gần nhất. Ô thử giá chỉ để tính thử, không lưu."
      />
      <Card className="mb-4 grid gap-3 p-4 sm:grid-cols-[1fr_220px]">
        <Field label="Món">
          {(id) => (
            <Select
              id={id}
              value={dishId ?? ''}
              onChange={(e) => {
                setParams(e.target.value ? { dish: e.target.value } : {});
                setTryStore('');
                setTryApp('');
              }}
            >
              <option value="">— Chọn món —</option>
              {list.data?.rows.map((r) => (
                <option key={r.dishId} value={r.dishId}>
                  {r.name} · {r.categoryName}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Tính chiết khấu theo app">
          {(id) => (
            <Select
              id={id}
              value={appId ?? ctx?.app?.id ?? ''}
              onChange={(e) => setAppId(e.target.value ? Number(e.target.value) : undefined)}
            >
              {(apps.data ?? [])
                .filter((a) => a.active)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({Number(a.commissionPct)}%)
                  </option>
                ))}
              {!apps.data?.length && <option value="">Chưa khai báo app</option>}
            </Select>
          )}
        </Field>
      </Card>

      {!row ? (
        <Card>
          <EmptyState title="Chọn một món để xem bảng tính giá" />
        </Card>
      ) : !row.hasRecipe ? (
        <Card>
          <EmptyState
            title="Món chưa có định mức"
            hint="Khai báo định mức nguyên liệu để tính giá vốn."
            action={
              <Link className="text-primary-ink underline" to="/admin/menu/dishes">
                Tới Món & định mức
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-w-0 flex-col gap-4">
            {row.missingPrices.length > 0 && (
              <p className="flex items-center gap-2 rounded-ctl bg-warn-soft px-3 py-2 text-[13px] text-warn">
                <AlertTriangle size={16} /> Chưa có giá nhập cho: {row.missingPrices.join(', ')} — giá vốn
                đang thiếu phần này.
              </p>
            )}
            <Card>
              <div
                tabIndex={0}
                role="region"
                aria-label="Bảng, cuộn ngang để xem thêm cột"
                className="overflow-x-auto"
              >
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="bg-primary-soft text-[13px] text-ink-strong">
                      <th className="px-4 py-2.5 text-left font-semibold">1 phần</th>
                      {CH.map((c) => (
                        <th key={c.key} className="px-4 py-2.5 text-right font-semibold">
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={r.key}
                        className={cn('border-b border-[#f2f4f7]', r.strong && 'font-semibold')}
                      >
                        <td className="px-4 py-2">{r.label}</td>
                        {CH.map((c) => {
                          const v = channels![c.key][r.key] as string | null;
                          const neg = r.neg && v !== null && Number(v) < 0;
                          return (
                            <td key={c.key} className={cn('px-4 py-2 text-right num', neg && 'text-bad')}>
                              {r.pct ? pctText(v) : v == null ? '—' : money(v)}
                              {neg && <Badge tone="bad">Lỗ</Badge>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card>
              <h2 className="border-b border-line px-4 py-3 font-semibold text-ink-strong">
                Định mức đang dùng
              </h2>
              <DataTable
                rows={row.lines}
                rowKey={(l) => `${l.ingredientId}-${l.scope}`}
                columns={[
                  {
                    key: 'name',
                    header: 'Nguyên liệu',
                    cell: (l) => (
                      <span>
                        {l.name} {l.scope === 'TAKEAWAY_APP' && <Badge tone="primary">Mang về / app</Badge>}
                      </span>
                    ),
                  },
                  {
                    key: 'qty',
                    header: 'Định mức',
                    align: 'right',
                    cell: (l) => (
                      <span className="num">
                        {l.qtyRecipe.replace('.', ',')} {l.recipeUnit}
                      </span>
                    ),
                  },
                  {
                    key: 'price',
                    header: 'Giá / đơn vị',
                    align: 'right',
                    cell: (l) =>
                      l.unitPriceRecipe ? (
                        <span className="num">
                          {money(Math.round(Number(l.unitPriceRecipe) * 100) / 100)}
                        </span>
                      ) : (
                        <Badge tone="warn">Chưa có</Badge>
                      ),
                  },
                  {
                    key: 'cost',
                    header: 'Thành tiền',
                    align: 'right',
                    cell: (l) => <b className="num">{money(l.cost)}</b>,
                  },
                ]}
              />
            </Card>
          </div>
          <div className="flex flex-col gap-4">
            <Card className="p-4">
              <h2 className="mb-3 font-semibold text-ink-strong">Thử giá bán</h2>
              <div className="grid gap-3">
                <Field label="Giá tại quán / mang về">
                  {(id) => (
                    <Input
                      id={id}
                      inputMode="numeric"
                      className="num text-right"
                      placeholder={row.channels.DINE_IN.price ? money(row.channels.DINE_IN.price) : ''}
                      value={tryStore}
                      onChange={(e) => setTryStore(e.target.value)}
                    />
                  )}
                </Field>
                <Field label="Giá trên app">
                  {(id) => (
                    <Input
                      id={id}
                      inputMode="numeric"
                      className="num text-right"
                      placeholder={row.channels.APP.price ? money(row.channels.APP.price) : ''}
                      value={tryApp}
                      onChange={(e) => setTryApp(e.target.value)}
                    />
                  )}
                </Field>
              </div>
            </Card>
            <Card className="p-4">
              <h2 className="mb-3 font-semibold text-ink-strong">Giá gợi ý</h2>
              <Field label="% nguyên liệu / giá mục tiêu">
                {(id) => (
                  <Input
                    id={id}
                    inputMode="decimal"
                    className="num text-right"
                    placeholder={row.targetPct}
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                  />
                )}
              </Field>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <dt className="text-muted">Tại quán</dt>
                <dd className="text-right text-lg font-bold num">{sugg?.store ? money(sugg.store) : '—'}</dd>
                <dt className="text-muted">App (giữ lãi / phần)</dt>
                <dd className="text-right text-lg font-bold num">{sugg?.app ? money(sugg.app) : '—'}</dd>
              </dl>
              <ApplyPrices dishId={row.dishId} store={sugg?.store ?? null} app={sugg?.app ?? null} />
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function ApplyPrices({ dishId, store, app }: { dishId: number; store: string | null; app: string | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [from, setFrom] = useState(today());
  const apply = useMutation({
    mutationFn: async () => {
      if (store)
        ok(
          await client.menu.setPrice({
            params: { id: dishId },
            body: { priceType: 'STORE', price: store, effectiveFrom: from },
          }),
        );
      if (app)
        ok(
          await client.menu.setPrice({
            params: { id: dishId },
            body: { priceType: 'APP', price: app, effectiveFrom: from },
          }),
        );
    },
    onSuccess: () => {
      toast('Đã áp dụng giá gợi ý');
      qc.invalidateQueries({ queryKey: ['pricing'] });
      qc.invalidateQueries({ queryKey: ['pricing-detail'] });
      qc.invalidateQueries({ queryKey: ['dishes'] });
    },
    onError: (e) => toast(errorMessage(e), 'bad'),
  });
  return (
    <div className="mt-4 grid gap-2 border-t border-line pt-3">
      <Field label="Áp dụng từ ngày">
        {(id) => <Input id={id} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}
      </Field>
      <Button
        variant="primary"
        loading={apply.isPending}
        disabled={!store && !app}
        onClick={() => apply.mutate()}
      >
        Áp dụng giá gợi ý
      </Button>
    </div>
  );
}

export function PriceAlertsPage() {
  const alerts = useQuery({
    queryKey: ['pricing', 'alerts'],
    queryFn: async () => ok(await client.pricing.alerts()),
  });
  const qc = useQueryClient();
  const toast = useToast();
  const [picked, setPicked] = useState<number[]>([]);
  const [from, setFrom] = useState(today);
  const rows = alerts.data ?? [];
  const applicable = rows.filter((r) => r.suggestedStorePrice);
  const allOn = applicable.length > 0 && applicable.every((r) => picked.includes(r.dishId));

  // Apply the suggested store (and app) price of every ticked dish from one date. Each price is audited server-side.
  const applyMany = useMutation({
    mutationFn: async () => {
      for (const r of rows.filter((x) => picked.includes(x.dishId))) {
        if (r.suggestedStorePrice)
          ok(
            await client.menu.setPrice({
              params: { id: r.dishId },
              body: { priceType: 'STORE', price: r.suggestedStorePrice, effectiveFrom: from },
            }),
          );
        if (r.suggestedAppPrice)
          ok(
            await client.menu.setPrice({
              params: { id: r.dishId },
              body: { priceType: 'APP', price: r.suggestedAppPrice, effectiveFrom: from },
            }),
          );
      }
    },
    onSuccess: () => {
      toast(`Đã áp dụng giá mới cho ${picked.length} món từ ${from.split('-').reverse().join('/')}`);
      setPicked([]);
      qc.invalidateQueries({ queryKey: ['pricing'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e) => toast(errorMessage(e), 'bad'),
  });

  return (
    <div>
      <PageHeader
        title="Cảnh báo giá"
        subtitle="Món đang lỗ hoặc có % nguyên liệu vượt mục tiêu, tính theo giá nhập gần nhất"
      />
      {applicable.length > 0 && (
        <Card className="mb-3 flex flex-wrap items-center gap-3 px-4 py-3">
          <label className="flex items-center gap-2 text-[13px] font-medium">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={allOn}
              onChange={(e) => setPicked(e.target.checked ? applicable.map((r) => r.dishId) : [])}
            />
            Chọn tất cả ({applicable.length})
          </label>
          <span className="flex-1" />
          <span className="text-[13px] text-muted">Áp dụng từ</span>
          <Input
            type="date"
            aria-label="Áp dụng từ ngày"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-9 w-40"
          />
          <Button
            variant="primary"
            disabled={!picked.length}
            loading={applyMany.isPending}
            onClick={() => applyMany.mutate()}
          >
            Áp dụng giá gợi ý ({picked.length} món)
          </Button>
        </Card>
      )}
      <Card>
        <DataTable<PricingRow>
          rows={alerts.data}
          loading={alerts.isLoading}
          rowKey={(r) => r.dishId}
          empty={<EmptyState title="Không có cảnh báo" hint="Tất cả món đang trong mục tiêu." />}
          columns={[
            {
              key: 'name',
              header: 'Món',
              cell: (r) => (
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    aria-label={`Chọn ${r.name}`}
                    className="size-4 accent-primary"
                    disabled={!r.suggestedStorePrice}
                    checked={picked.includes(r.dishId)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      setPicked((p) =>
                        e.target.checked ? [...p, r.dishId] : p.filter((x) => x !== r.dishId),
                      )
                    }
                  />
                  {r.name}{' '}
                  {r.alert === 'LOSS' ? (
                    <Badge tone="bad">Đang lỗ</Badge>
                  ) : (
                    <Badge tone="warn">Vượt mục tiêu</Badge>
                  )}
                </span>
              ),
            },
            {
              key: 'price',
              header: 'Giá hiện tại',
              align: 'right',
              cell: (r) => (
                <span className="num">
                  {r.channels.DINE_IN.price ? money(r.channels.DINE_IN.price) : '—'}
                </span>
              ),
            },
            {
              key: 'cost',
              header: 'Giá vốn',
              align: 'right',
              cell: (r) => <span className="num">{money(r.channels.DINE_IN.directCost)}</span>,
            },
            {
              key: 'fc',
              header: '% NL / mục tiêu',
              align: 'right',
              cell: (r) => (
                <span className="num">
                  {pctText(r.channels.DINE_IN.foodCostPct)} / {Number(r.targetPct)}%
                </span>
              ),
            },
            {
              key: 'sugg',
              header: 'Giá gợi ý',
              align: 'right',
              cell: (r) => (
                <b className="num">{r.suggestedStorePrice ? money(r.suggestedStorePrice) : '—'}</b>
              ),
            },
            ...(rows.some((r) => r.suggestedAppPrice)
              ? [
                  {
                    key: 'app',
                    header: 'Gợi ý app',
                    align: 'right' as const,
                    secondary: true,
                    cell: (r: PricingRow) => (
                      <span className="num">{r.suggestedAppPrice ? money(r.suggestedAppPrice) : '—'}</span>
                    ),
                  },
                ]
              : []),
          ]}
          actions={(r) => (
            <Link
              to={`/admin/menu/cost-sheet?dish=${r.dishId}`}
              className="inline-flex h-[34px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-ctl bg-primary-soft px-3 text-[13px] font-semibold text-primary-ink"
            >
              Xem & áp dụng <ArrowRight size={14} />
            </Link>
          )}
        />
      </Card>
    </div>
  );
}
