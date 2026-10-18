import { Fragment, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/PageHeader';
import { LineChart } from '@/components/charts/LineChart';
import { Badge, Card, EmptyState, Segmented, Select } from '@/components/ui/controls';
import { DataTable } from '@/components/ui/DataTable';
import { Field } from '@/components/ui/Input';
import { client, ok } from '@/lib/api-client';
import { dateVi, money } from '@/lib/format';
import { priceTypeLabel, useDeliveryApps } from '@/lib/delivery-apps';

/** One price list: store, general app price, or one app's own price. */
const listKey = (p: { priceType: string; deliveryAppId: number | null }) =>
  p.deliveryAppId === null ? p.priceType : `APP:${p.deliveryAppId}`;

/** Selling-price changes of one dish over time (the dish's price list, newest first). */
export function DishPriceHistoryPage() {
  const [params, setParams] = useSearchParams();
  const dishId = params.get('dish') ? Number(params.get('dish')) : null;
  const [list, setList] = useState('STORE');
  const apps = useDeliveryApps().data;

  const dishes = useQuery({
    queryKey: ['dishes'],
    queryFn: async () => ok(await client.menu.listDishes({ query: {} })),
  });
  const dish = useQuery({
    queryKey: ['dish', dishId],
    enabled: dishId !== null,
    queryFn: async () => ok(await client.menu.getDish({ params: { id: dishId! } })),
  });

  // Each change compared with the previous price of the same list (type and app).
  const rows = useMemo(() => {
    const prices = dish.data?.prices ?? []; // newest first
    return prices.map((p) => {
      const prev = prices.find((x) => listKey(x) === listKey(p) && x.effectiveFrom < p.effectiveFrom);
      const diff = prev ? Number(p.price) - Number(prev.price) : null;
      const pct = prev && Number(prev.price) > 0 ? (diff! / Number(prev.price)) * 100 : null;
      return { ...p, diff, pct };
    });
  }, [dish.data]);

  const lists = [...new Set(rows.map(listKey))].map((k) => ({
    value: k,
    label:
      k === 'STORE'
        ? 'Tại quán'
        : priceTypeLabel(
            rows.find((r) => listKey(r) === k)!,
            apps,
          ).replace('App · ', ''),
  }));
  const shownList = lists.some((l) => l.value === list) ? list : 'STORE';
  const series = rows
    .filter((r) => listKey(r) === shownList)
    .reverse()
    .map((r) => ({ label: dateVi(r.effectiveFrom), value: Number(r.price) }));
  const d = dish.data;

  return (
    <div>
      <PageHeader title="Lịch sử giá bán" subtitle="Các lần đổi giá bán của từng món, theo ngày áp dụng" />
      <Card className="mb-4 p-4">
        <div className="max-w-sm">
          <Field label="Món">
            {(id) => (
              <Select
                id={id}
                value={dishId ?? ''}
                onChange={(e) => setParams(e.target.value ? { dish: e.target.value } : {}, { replace: true })}
              >
                <option value="">— Chọn món —</option>
                {dishes.data?.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} · {x.categoryName}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </Card>

      {dishId !== null && d && (
        <Card className="p-4">
          {rows.length === 0 ? (
            <EmptyState title="Món này chưa có giá" />
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-[13px] text-muted">Giá tại quán / mang về hiện tại</div>
                  <div className="text-2xl font-bold text-ink-strong">
                    {d.storePrice ? `${money(d.storePrice)} ₫` : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[13px] text-muted">Giá trên app hiện tại</div>
                  <div className="text-2xl font-bold text-ink-strong">
                    {d.appPrice ? `${money(d.appPrice)} ₫` : '—'}
                  </div>
                  {d.appPrices.length > 0 && (
                    <dl className="mt-1 grid grid-cols-[auto_auto] justify-start gap-x-3 text-[13px]">
                      {d.appPrices.map((p) => (
                        <Fragment key={p.deliveryAppId}>
                          <dt className="text-muted">
                            {apps?.find((a) => a.id === p.deliveryAppId)?.name ?? `App #${p.deliveryAppId}`}
                          </dt>
                          <dd className="num font-semibold">{money(p.price)} ₫</dd>
                        </Fragment>
                      ))}
                    </dl>
                  )}
                </div>
              </div>
              {lists.length > 1 && (
                <div className="overflow-x-auto">
                  <Segmented label="Biểu đồ giá" value={shownList} onChange={setList} options={lists} />
                </div>
              )}
              {series.length > 1 && (
                <LineChart ariaLabel="Giá bán theo thời gian" points={series} format={(v) => money(v)} />
              )}
              <DataTable
                rows={rows}
                rowKey={(r) => r.id}
                columns={[
                  { key: 'from', header: 'Áp dụng từ', cell: (r) => dateVi(r.effectiveFrom) },
                  { key: 'type', header: 'Loại giá', cell: (r) => priceTypeLabel(r, apps) },
                  {
                    key: 'price',
                    header: 'Giá bán',
                    align: 'right',
                    cell: (r) => <b className="num">{money(r.price)}</b>,
                  },
                  {
                    key: 'diff',
                    header: 'So với giá trước',
                    align: 'right',
                    cell: (r) =>
                      r.diff === null ? (
                        <span className="text-faint">Giá đầu tiên</span>
                      ) : r.diff === 0 ? (
                        '—'
                      ) : (
                        <Badge tone={r.diff > 0 ? 'good' : 'warn'}>
                          {r.diff > 0 ? '▲ +' : '▼ −'}
                          {money(Math.abs(r.diff))}
                          {r.pct !== null && ` (${Math.abs(r.pct).toFixed(1).replace('.', ',')}%)`}
                        </Badge>
                      ),
                  },
                ]}
              />
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
