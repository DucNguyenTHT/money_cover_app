import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { DishProfitReport } from '@ketoan/api/contracts';
import { PageHeader } from '@/components/PageHeader';
import { Card, Select, Switch } from '@/components/ui/controls';
import { DivergingBars } from '@/components/charts/Charts';
import {
  ExportButton,
  RangePicker,
  ReportTable,
  Signed,
  StatCard,
  pctText,
  thisMonthRange,
  type Range,
} from '@/components/report';
import { client, ok } from '@/lib/api-client';
import { dateVi, money, qty } from '@/lib/format';

type Channel = 'DINE_IN' | 'TAKEAWAY' | 'APP';
type Row = DishProfitReport['rows'][number];

// ---------------------------------------------------------------- dish profit

export function DishProfitPage() {
  const [range, setRange] = useState<Range>(thisMonthRange);
  const [channel, setChannel] = useState<Channel | ''>('');
  const [onlyLoss, setOnlyLoss] = useState(false);
  const q = useQuery({
    queryKey: ['report', 'dish-profit', range, channel],
    queryFn: async () =>
      ok(await client.reports.dishProfit({ query: { ...range, ...(channel ? { channel } : {}) } })),
  });
  const d = q.data;
  // Worst first so loss-making dishes are on top.
  const rows = useMemo(
    () =>
      [...(d?.rows ?? [])]
        .sort((a, b) => Number(a.netProfit) - Number(b.netProfit))
        .filter((r) => !onlyLoss || Number(r.netProfit) < 0),
    [d, onlyLoss],
  );
  const total = (k: keyof Row) => rows.reduce((s, r) => s + Number(r[k]), 0);
  const losing = (d?.rows ?? []).filter((r) => Number(r.netProfit) < 0).length;

  return (
    <div>
      <PageHeader
        title="Lãi theo món"
        subtitle="Doanh thu thuần − giá vốn định mức − hao hụt kiểm kê phân bổ − chiết khấu app − chi phí chung"
        actions={
          d && (
            <ExportButton
              filename={`lai-theo-mon-${range.from}-${range.to}`}
              title={`Lãi theo món ${dateVi(range.from)} – ${dateVi(range.to)}`}
              sheets={() => [
                {
                  name: 'Lãi theo món',
                  columns: [
                    { header: 'Món', kind: 'text' },
                    { header: 'Nhóm', kind: 'text' },
                    { header: 'SL', kind: 'int' },
                    { header: 'Doanh thu thuần', kind: 'money' },
                    { header: 'Giá vốn', kind: 'money' },
                    { header: 'Lãi gộp', kind: 'money' },
                    { header: 'Food cost %', kind: 'pct' },
                    { header: 'Hao hụt kiểm kê', kind: 'money' },
                    { header: 'Lãi sau kiểm kê', kind: 'money' },
                    { header: 'Chiết khấu app', kind: 'money' },
                    { header: 'Chi phí chung', kind: 'money' },
                    { header: 'Lãi ròng', kind: 'money' },
                    { header: 'Lãi ròng / phần', kind: 'money' },
                  ],
                  rows: rows.map((r) => [
                    r.name,
                    r.category,
                    r.qty,
                    Number(r.netRevenue),
                    Number(r.cost),
                    Number(r.grossProfit),
                    r.foodCostPct === null ? null : Number(r.foodCostPct),
                    Number(r.stocktake),
                    Number(r.afterStocktake),
                    Number(r.appCommission),
                    Number(r.overhead),
                    Number(r.netProfit),
                    Number(r.perPortion),
                  ]),
                },
              ]}
            />
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <RangePicker value={range} onChange={setRange} />
        <div className="w-44">
          <Select
            aria-label="Kênh"
            value={channel}
            onChange={(e) => setChannel(e.target.value as Channel | '')}
          >
            <option value="">Tất cả kênh</option>
            <option value="DINE_IN">Tại bàn</option>
            <option value="TAKEAWAY">Mang về</option>
            <option value="APP">App giao hàng</option>
          </Select>
        </div>
        <Switch checked={onlyLoss} onChange={setOnlyLoss} label={`Chỉ món lỗ (${losing})`} />
      </div>
      {d && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Doanh thu thuần các món"
              value={money(total('netRevenue'))}
              sub={`${total('qty')} phần`}
            />
            <StatCard
              label="Lãi gộp"
              value={<Signed v={total('grossProfit')} />}
              sub={`Giá vốn ${money(total('cost'))}`}
            />
            <StatCard
              label="Lãi ròng các món"
              value={<Signed v={total('netProfit')} />}
              sub={`Tỷ lệ chi phí chung ${pctText(d.overheadRate)}`}
            />
            <StatCard
              label="Món đang lỗ"
              value={losing}
              tone={losing ? 'bad' : undefined}
              sub={d.stocktakeIncluded ? 'Đã gồm hao hụt kiểm kê' : 'Lọc theo kênh: không phân bổ hao hụt'}
            />
          </div>
          {rows.length > 0 && (
            <Card className="mb-4 p-4">
              <h2 className="mb-3 font-semibold">Lãi ròng theo món</h2>
              <DivergingBars
                rows={rows.slice(0, 20).map((r) => ({
                  label: r.name,
                  value: Number(r.netProfit),
                  hint: `${r.qty} phần · lãi / phần ${money(r.perPortion)}`,
                }))}
                format={(v) => money(v)}
              />
            </Card>
          )}
          <Card className="mb-4">
            <ReportTable
              minWidth={1150}
              head={[
                'Món',
                'SL',
                'DT thuần',
                'Giá vốn',
                'Lãi gộp',
                'Food cost',
                'Hao hụt KK',
                'Sau kiểm kê',
                'CK app',
                'CP chung',
                'Lãi ròng',
                '/ phần',
              ]}
              rows={rows.map((r) => [
                <span key="n">
                  <span className="font-medium">{r.name}</span>
                  <span className="block text-xs text-muted">{r.category}</span>
                </span>,
                r.qty,
                money(r.netRevenue),
                money(r.cost),
                <Signed key="g" v={r.grossProfit} lossTag={false} />,
                pctText(r.foodCostPct),
                money(r.stocktake),
                <Signed key="a" v={r.afterStocktake} lossTag={false} />,
                money(r.appCommission),
                money(r.overhead),
                <Signed key="p" v={r.netProfit} strong />,
                <Signed key="pp" v={r.perPortion} lossTag={false} />,
              ])}
              total={[
                'Tổng',
                total('qty'),
                money(total('netRevenue')),
                money(total('cost')),
                money(total('grossProfit')),
                '',
                money(total('stocktake')),
                money(total('afterStocktake')),
                money(total('appCommission')),
                money(total('overhead')),
                <Signed key="t" v={total('netProfit')} />,
                '',
              ]}
            />
          </Card>
          {d.reconciliation && !onlyLoss && (
            <Card className="max-w-xl p-4 text-[13px]">
              <h3 className="mb-2 font-semibold">Đối chiếu với lợi nhuận ròng</h3>
              <Rec k="Tổng lãi sau kiểm kê của các món" v={d.reconciliation.dishesAfterStocktake} />
              <Rec k="+ Phụ thu / phí phục vụ" v={d.reconciliation.serviceCharge} />
              <Rec k="− Hao hụt chung (không món nào dùng)" v={d.reconciliation.generalLoss} />
              <Rec k="− Xuất huỷ" v={d.reconciliation.disposal} />
              <Rec k="− Chiết khấu app" v={d.reconciliation.appCommission} />
              <Rec k="− Dùng nội bộ" v={d.reconciliation.internalUse} />
              <Rec k="− Chi phí chung" v={d.reconciliation.overhead} />
              <div className="mt-1 flex justify-between border-t border-line pt-2 font-semibold">
                <span>= Lợi nhuận ròng</span>
                <Signed v={d.reconciliation.result} />
              </div>
              <p className="mt-1 text-xs text-muted">
                Báo cáo lãi lỗ: {money(d.reconciliation.pnlNetProfit)} (lệch{' '}
                {money(Number(d.reconciliation.result) - Number(d.reconciliation.pnlNetProfit))} do làm tròn)
              </p>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

const Rec = ({ k, v }: { k: string; v: string }) => (
  <div className="flex justify-between py-0.5">
    <span className="text-muted">{k}</span>
    <span className="num">{money(v)}</span>
  </div>
);

// ---------------------------------------------------------------- stock movement

export function StockMovementPage() {
  const [range, setRange] = useState<Range>(thisMonthRange);
  const [showQty, setShowQty] = useState(false);
  const q = useQuery({
    queryKey: ['report', 'stock-movement', range],
    queryFn: async () => ok(await client.reports.stockMovement({ query: range })),
  });
  const rows = q.data?.rows ?? [];
  const cols = [
    'opening',
    'purchased',
    'surplus',
    'sold',
    'disposed',
    'returned',
    'internal',
    'shortage',
    'produced',
    'usedInProduction',
    'closing',
  ] as const;
  const heads = [
    'Tồn đầu',
    'Nhập mua',
    'Thừa KK',
    'Bán (giá vốn)',
    'Xuất huỷ',
    'Trả NCC',
    'Nội bộ',
    'Thiếu KK',
    'Chế biến ra',
    'Đem chế biến',
    'Tồn cuối',
  ];
  const sumV = (k: (typeof cols)[number]) => rows.reduce((s, r) => s + Number(r[k].value), 0);
  const balance =
    sumV('opening') +
    sumV('purchased') +
    sumV('surplus') -
    sumV('sold') -
    sumV('disposed') -
    sumV('returned') -
    sumV('internal') -
    sumV('shortage') +
    sumV('produced') -
    sumV('usedInProduction') -
    sumV('closing');

  return (
    <div>
      <PageHeader
        title="Nhập – xuất – tồn"
        subtitle="Theo giá trị FIFO của từng lô; tồn đầu + nhập + thừa − xuất − thiếu = tồn cuối"
        actions={
          <ExportButton
            filename={`nhap-xuat-ton-${range.from}-${range.to}`}
            title={`Nhập – xuất – tồn ${dateVi(range.from)} – ${dateVi(range.to)}`}
            sheets={() => [
              {
                name: 'NXT',
                columns: [
                  { header: 'Mã', kind: 'text' },
                  { header: 'Nguyên liệu', kind: 'text' },
                  { header: 'ĐVT', kind: 'text' },
                  ...heads.flatMap((h) => [
                    { header: `${h} SL`, kind: 'qty' as const },
                    { header: `${h} giá trị`, kind: 'money' as const },
                  ]),
                ],
                rows: rows.map((r) => [
                  r.code,
                  r.name,
                  r.unit,
                  ...cols.flatMap((k) => [Number(r[k].qty), Number(r[k].value)]),
                ]),
              },
            ]}
          />
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <RangePicker value={range} onChange={setRange} />
        <Switch checked={showQty} onChange={setShowQty} label="Hiện số lượng" />
      </div>
      <Card>
        <ReportTable
          minWidth={1300}
          head={['Nguyên liệu', ...heads]}
          rows={rows.map((r) => [
            <span key="n">
              <span className="font-medium">{r.name}</span>
              <span className="block text-xs text-muted">
                {r.code} · {r.unit}
              </span>
            </span>,
            ...cols.map((k) => (
              <span key={k} className="flex flex-col items-end">
                <span>{Number(r[k].value) ? money(r[k].value) : '—'}</span>
                {showQty && Number(r[k].qty) !== 0 && (
                  <span className="text-xs text-muted">{qty(r[k].qty)}</span>
                )}
              </span>
            )),
          ])}
          total={['Tổng giá trị', ...cols.map((k) => money(sumV(k)))]}
        />
        {rows.length > 0 && (
          <p className="px-4 py-2 text-xs text-muted">
            Cân đối: {Math.abs(balance) < 1 ? 'khớp' : `lệch ${money(balance)} (làm tròn)`}.
          </p>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- variance

export function VariancePage() {
  const [range, setRange] = useState<Range>(thisMonthRange);
  const q = useQuery({
    queryKey: ['report', 'variance', range],
    queryFn: async () => ok(await client.reports.variance({ query: range })),
  });
  const rows = q.data ?? [];
  const total = rows.reduce((s, r) => s + Number(r.lossValue), 0);
  return (
    <div>
      <PageHeader
        title="Chênh lệch định mức"
        subtitle="Thực tế so với sổ sách ở các lần kiểm kê đã chốt — dòng thiếu nhiều là nơi định mức chưa đúng hoặc thất thoát"
        actions={
          <ExportButton
            filename={`chenh-lech-${range.from}-${range.to}`}
            title={`Chênh lệch kiểm kê ${dateVi(range.from)} – ${dateVi(range.to)}`}
            sheets={() => [
              {
                name: 'Chênh lệch',
                columns: [
                  { header: 'Ngày kiểm', kind: 'text' },
                  { header: 'Mã', kind: 'text' },
                  { header: 'Nguyên liệu', kind: 'text' },
                  { header: 'ĐVT', kind: 'text' },
                  { header: 'Sổ sách', kind: 'qty' },
                  { header: 'Thực tế', kind: 'qty' },
                  { header: 'Chênh lệch', kind: 'qty' },
                  { header: 'Giá trị (thiếu +)', kind: 'money' },
                ],
                rows: rows.map((r) => [
                  dateVi(r.day),
                  r.code,
                  r.name,
                  r.unit,
                  Number(r.bookQty),
                  Number(r.actualQty),
                  Number(r.diffQty),
                  Number(r.lossValue),
                ]),
              },
            ]}
          />
        }
      />
      <div className="mb-4">
        <RangePicker value={range} onChange={setRange} />
      </div>
      <Card>
        <ReportTable
          head={['Nguyên liệu', 'Ngày kiểm', 'Sổ sách', 'Thực tế', 'Chênh lệch', '% sổ sách', 'Giá trị']}
          align={['l', 'l', 'r', 'r', 'r', 'r', 'r']}
          rows={rows.map((r) => {
            const diff = Number(r.diffQty);
            return [
              <span key="n">
                <span className="font-medium">{r.name}</span>{' '}
                <span className="text-xs text-muted">{r.code}</span>
              </span>,
              dateVi(r.day),
              `${qty(r.bookQty)} ${r.unit}`,
              `${qty(r.actualQty)} ${r.unit}`,
              <span key="d" className={diff < 0 ? 'font-semibold text-bad' : 'font-semibold text-warn'}>
                {diff < 0 ? 'Thiếu ' : 'Thừa '}
                {qty(Math.abs(diff))}
              </span>,
              Number(r.bookQty) ? pctText(((diff / Number(r.bookQty)) * 100).toFixed(1)) : '—',
              money(r.lossValue),
            ];
          })}
          total={['Tổng (thiếu − thừa)', '', '', '', '', '', money(total)]}
        />
      </Card>
    </div>
  );
}
