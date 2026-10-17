import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import type { StockRow } from '@ketoan/api/contracts';
import { PageHeader } from '@/components/PageHeader';
import { IngredientPicker } from '@/components/IngredientPicker';
import { LineChart } from '@/components/charts/LineChart';
import { Badge, Card, EmptyState } from '@/components/ui/controls';
import { DataTable } from '@/components/ui/DataTable';
import { Dialog } from '@/components/ui/Dialog';
import { SearchInput } from '@/components/ui/SearchInput';
import { client, ok } from '@/lib/api-client';
import { dateVi, money, qty } from '@/lib/format';
import { REASON } from './IssuesPage';

export function StockPage() {
  const [q, setQ] = useState('');
  const [lotsOf, setLotsOf] = useState<StockRow | null>(null);
  const stock = useQuery({ queryKey: ['stock'], queryFn: async () => ok(await client.inventory.stock()) });
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (stock.data ?? []).filter(
      (r) => !t || r.name.toLowerCase().includes(t) || r.code.toLowerCase().includes(t),
    );
  }, [stock.data, q]);
  const totalValue = rows.reduce((s, r) => s + Number(r.value), 0);

  return (
    <div>
      <PageHeader
        title="Tồn kho hiện tại"
        subtitle="Giá trị tồn = số lượng còn của từng lô × giá nhập của lô đó"
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <SearchInput
            className="w-full max-w-xs"
            aria-label="Tìm"
            placeholder="Tìm nguyên liệu"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <span className="ml-auto text-[13px] text-muted">
            Giá trị tồn <b className="text-ink num">{money(totalValue)}</b>
          </span>
        </div>
        <DataTable<StockRow>
          rows={rows}
          loading={stock.isLoading}
          rowKey={(r) => r.ingredientId}
          onRowClick={setLotsOf}
          empty={<EmptyState title="Chưa có nguyên liệu" />}
          columns={[
            { key: 'name', header: 'Nguyên liệu', cell: (r) => r.name },
            { key: 'category', header: 'Nhóm', secondary: true, cell: (r) => r.category ?? '—' },
            {
              key: 'qty',
              header: 'Tồn',
              align: 'right',
              cell: (r) => (
                <span className="num">
                  {qty(r.qtyOnHand)} {r.unit}
                </span>
              ),
            },
            {
              key: 'pending',
              header: 'Nợ kho',
              align: 'right',
              cell: (r) =>
                Number(r.pendingQty) > 0 ? (
                  <Badge tone="warn">
                    {qty(r.pendingQty)} {r.unit}
                  </Badge>
                ) : (
                  '—'
                ),
            },
            {
              key: 'last',
              header: 'Giá nhập gần nhất',
              align: 'right',
              secondary: true,
              cell: (r) => (r.lastPrice ? <span className="num">{money(r.lastPrice)}</span> : '—'),
            },
            {
              key: 'value',
              header: 'Giá trị tồn',
              align: 'right',
              cell: (r) => <b className="num">{money(r.value)}</b>,
            },
          ]}
        />
      </Card>
      {lotsOf && <LotsDialog row={lotsOf} onClose={() => setLotsOf(null)} />}
    </div>
  );
}

function LotsDialog({ row, onClose }: { row: StockRow; onClose: () => void }) {
  const lots = useQuery({
    queryKey: ['lots', row.ingredientId, 'open'],
    queryFn: async () =>
      ok(await client.inventory.lots({ query: { ingredientId: row.ingredientId, open: 'true' } })),
  });
  return (
    <Dialog open onClose={onClose} title={`Các lô còn tồn: ${row.name}`} width={640}>
      <DataTable
        rows={lots.data}
        loading={lots.isLoading}
        rowKey={(l) => l.id}
        empty={<EmptyState title="Không còn lô nào" />}
        columns={[
          { key: 'date', header: 'Ngày nhập', cell: (l) => dateVi(l.date) },
          { key: 'source', header: 'Nguồn', cell: (l) => l.source },
          {
            key: 'price',
            header: 'Giá',
            align: 'right',
            cell: (l) => <span className="num">{money(l.unitPrice)}</span>,
          },
          {
            key: 'left',
            header: 'Còn / nhập',
            align: 'right',
            cell: (l) => (
              <span className="num">
                {qty(l.qtyRemaining)} / {qty(l.qtyIn)} {row.unit}
              </span>
            ),
          },
        ]}
      />
    </Dialog>
  );
}

export function PendingPage() {
  const list = useQuery({ queryKey: ['pending'], queryFn: async () => ok(await client.inventory.pending()) });
  return (
    <div>
      <PageHeader
        title="Nợ kho"
        subtitle="Đã bán nhưng kho chưa đủ hàng (thường do chưa nhập phiếu nhập). Giá vốn đang tạm tính theo giá nhập gần nhất; khi nhập hàng sẽ tự trừ và tính lại giá thật."
      />
      <Card>
        <DataTable
          rows={list.data}
          loading={list.isLoading}
          rowKey={(r) => r.issueItemId}
          empty={<EmptyState title="Không có nợ kho" hint="Tháng còn nợ kho sẽ không khoá sổ được." />}
          columns={[
            { key: 'ing', header: 'Nguyên liệu', cell: (r) => r.ingredientName },
            { key: 'date', header: 'Ngày', cell: (r) => dateVi(r.date) },
            {
              key: 'src',
              header: 'Từ',
              cell: (r) => (r.orderId ? `Đơn #${r.orderId}` : REASON[r.reason].label),
            },
            {
              key: 'qty',
              header: 'Còn thiếu',
              align: 'right',
              cell: (r) => (
                <b className="num">
                  {qty(r.pendingQty)} {r.unit}
                </b>
              ),
            },
            {
              key: 'price',
              header: 'Giá tạm',
              align: 'right',
              secondary: true,
              cell: (r) =>
                r.pendingUnitPrice ? <span className="num">{money(r.pendingUnitPrice)}</span> : '—',
            },
          ]}
        />
      </Card>
    </div>
  );
}

export function PriceHistoryPage() {
  const [ingredientId, setIngredientId] = useState<number | null>(null);
  const hist = useQuery({
    queryKey: ['price-history', ingredientId],
    enabled: ingredientId !== null,
    queryFn: async () => ok(await client.inventory.priceHistory({ query: { ingredientId: ingredientId! } })),
  });
  const data = hist.data ?? [];
  const first = data[0];
  const last = data[data.length - 1];
  const change =
    first && last && Number(first.unitPrice) > 0
      ? ((Number(last.unitPrice) - Number(first.unitPrice)) / Number(first.unitPrice)) * 100
      : null;

  return (
    <div>
      <PageHeader title="Lịch sử giá nhập" subtitle="Giá nhập của từng lần nhập hàng" />
      <Card className="mb-4 p-4">
        <div className="max-w-sm">
          <IngredientPicker
            value={ingredientId}
            onChange={(i) => setIngredientId(i.id)}
            placeholder="Chọn nguyên liệu…"
          />
        </div>
      </Card>
      {ingredientId !== null && (
        <Card className="p-4">
          {data.length === 0 ? (
            <EmptyState title="Chưa có lần nhập hàng nào" />
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="text-[13px] text-muted">Giá gần nhất</span>
                <span className="text-2xl font-bold text-ink-strong">{money(last!.unitPrice)} ₫</span>
                {change !== null && data.length > 1 && (
                  <Badge tone={change > 0 ? 'bad' : 'good'}>
                    {change > 0 ? '▲' : '▼'} {Math.abs(change).toFixed(1).replace('.', ',')}% so với lần đầu
                  </Badge>
                )}
              </div>
              <LineChart
                ariaLabel="Giá nhập theo thời gian"
                points={data.map((d) => ({ label: dateVi(d.date), value: Number(d.unitPrice) }))}
                format={(v) => money(v)}
              />
              <DataTable
                rows={[...data].reverse()}
                rowKey={(r) => `${r.receiptId}-${r.date}-${r.unitPrice}`}
                columns={[
                  { key: 'date', header: 'Ngày', cell: (r) => dateVi(r.date) },
                  { key: 'sup', header: 'Nhà cung cấp', cell: (r) => r.supplier ?? '—' },
                  {
                    key: 'qty',
                    header: 'Số lượng',
                    align: 'right',
                    cell: (r) => <span className="num">{qty(r.qty)}</span>,
                  },
                  {
                    key: 'price',
                    header: 'Đơn giá',
                    align: 'right',
                    cell: (r) => <b className="num">{money(r.unitPrice)}</b>,
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
