import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { PriceType } from '@ketoan/api/domain';
import { PageHeader } from '@/components/PageHeader';
import { LineChart } from '@/components/charts/LineChart';
import { Badge, Card, EmptyState, Segmented, Select } from '@/components/ui/controls';
import { DataTable } from '@/components/ui/DataTable';
import { Field } from '@/components/ui/Input';
import { client, ok } from '@/lib/api-client';
import { dateVi, money } from '@/lib/format';

const TYPE_LABEL: Record<PriceType, string> = { STORE: 'Tại quán / mang về', APP: 'App' };

/** Selling-price changes of one dish over time (the dish's price list, newest first). */
export function DishPriceHistoryPage() {
  const [params, setParams] = useSearchParams();
  const dishId = params.get('dish') ? Number(params.get('dish')) : null;
  const [type, setType] = useState<PriceType>('STORE');

  const dishes = useQuery({
    queryKey: ['dishes'],
    queryFn: async () => ok(await client.menu.listDishes({ query: {} })),
  });
  const dish = useQuery({
    queryKey: ['dish', dishId],
    enabled: dishId !== null,
    queryFn: async () => ok(await client.menu.getDish({ params: { id: dishId! } })),
  });

  // Each change compared with the previous price of the same type.
  const rows = useMemo(() => {
    const prices = dish.data?.prices ?? []; // newest first
    return prices.map((p) => {
      const prev = prices.find((x) => x.priceType === p.priceType && x.effectiveFrom < p.effectiveFrom);
      const diff = prev ? Number(p.price) - Number(prev.price) : null;
      const pct = prev && Number(prev.price) > 0 ? (diff! / Number(prev.price)) * 100 : null;
      return { ...p, diff, pct };
    });
  }, [dish.data]);

  const hasApp = rows.some((r) => r.priceType === 'APP');
  const series = rows
    .filter((r) => r.priceType === (hasApp ? type : 'STORE'))
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
                </div>
              </div>
              {hasApp && (
                <div>
                  <Segmented
                    label="Biểu đồ giá"
                    value={type}
                    onChange={setType}
                    options={[
                      { value: 'STORE', label: 'Tại quán' },
                      { value: 'APP', label: 'App' },
                    ]}
                  />
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
                  { key: 'type', header: 'Loại giá', cell: (r) => TYPE_LABEL[r.priceType] },
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
