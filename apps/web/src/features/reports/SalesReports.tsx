import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/PageHeader';
import { Badge, Card, Segmented } from '@/components/ui/controls';
import { DivergingBars, SERIES, SeriesChart } from '@/components/charts/Charts';
import {
  ExportButton,
  RangePicker,
  ReportTable,
  Signed,
  StatCard,
  thisMonthRange,
  type Range,
} from '@/components/report';
import { client, ok } from '@/lib/api-client';
import { dateVi, money } from '@/lib/format';

const CHANNEL: Record<string, string> = { DINE_IN: 'Tại bàn', TAKEAWAY: 'Mang về', APP: 'App' };
const short = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const time = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
      })
    : '';

// ---------------------------------------------------------------- daily

export function DailyReportPage() {
  const [range, setRange] = useState<Range>(thisMonthRange);
  const q = useQuery({
    queryKey: ['report', 'daily', range],
    queryFn: async () => ok(await client.reports.daily({ query: range })),
  });
  const rows = q.data ?? [];
  const sum = (k: 'netRevenue' | 'cost' | 'grossProfit' | 'discounts' | 'vat' | 'appCommission') =>
    rows.reduce((s, r) => s + Number(r[k]), 0);
  const orders = rows.reduce((s, r) => s + r.orders, 0);
  const guests = rows.reduce((s, r) => s + r.guests, 0);

  return (
    <div>
      <PageHeader
        title="Báo cáo cuối ngày"
        subtitle="Số theo ngày là tạm tính — lãi lỗ chốt theo tháng"
        actions={
          <ExportButton
            filename={`bao-cao-ngay-${range.from}-${range.to}`}
            title={`Báo cáo theo ngày ${dateVi(range.from)} – ${dateVi(range.to)}`}
            sheets={() => [
              {
                name: 'Theo ngày',
                columns: [
                  { header: 'Ngày', kind: 'text' },
                  { header: 'Số đơn', kind: 'int' },
                  { header: 'Số khách', kind: 'int' },
                  { header: 'Doanh thu thuần', kind: 'money' },
                  { header: 'Giá vốn', kind: 'money' },
                  { header: 'Lãi gộp', kind: 'money' },
                  { header: 'Giảm giá', kind: 'money' },
                  { header: 'VAT', kind: 'money' },
                  { header: 'Đơn huỷ', kind: 'int' },
                  { header: 'Chênh lệch tiền mặt', kind: 'money' },
                ],
                rows: rows.map((r) => [
                  dateVi(r.day),
                  r.orders,
                  r.guests,
                  Number(r.netRevenue),
                  Number(r.cost),
                  Number(r.grossProfit),
                  Number(r.discounts),
                  Number(r.vat),
                  r.cancelled,
                  r.cashDiff === null ? null : Number(r.cashDiff),
                ]),
              },
            ]}
          />
        }
      />
      <div className="mb-4">
        <RangePicker value={range} onChange={setRange} />
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Doanh thu thuần"
          value={money(sum('netRevenue'))}
          sub={`${orders} đơn · ${guests} khách`}
        />
        <StatCard
          label="Lãi gộp (tạm tính)"
          value={<Signed v={sum('grossProfit')} />}
          sub={`Giá vốn ${money(sum('cost'))}`}
        />
        <StatCard label="Giảm giá" value={money(sum('discounts'))} sub={`VAT đã thu ${money(sum('vat'))}`} />
        <StatCard
          label="TB / đơn"
          value={orders ? money(Math.round(sum('netRevenue') / orders)) : '—'}
          sub={`Chiết khấu app ${money(sum('appCommission'))}`}
        />
      </div>
      {rows.length > 1 && (
        <Card className="mb-4 p-4">
          <SeriesChart
            ariaLabel="Doanh thu thuần và lãi gộp theo ngày"
            labels={rows.map((r) => short(r.day))}
            series={[
              {
                name: 'Doanh thu thuần',
                color: SERIES.blue,
                kind: 'line',
                values: rows.map((r) => Number(r.netRevenue)),
              },
              {
                name: 'Lãi gộp',
                color: SERIES.orange,
                kind: 'line',
                values: rows.map((r) => Number(r.grossProfit)),
              },
            ]}
            format={(v) => money(v)}
            tickEvery={Math.ceil(rows.length / 10)}
          />
        </Card>
      )}
      <Card>
        <ReportTable
          head={[
            'Ngày',
            'Đơn',
            'Khách',
            'Doanh thu thuần',
            'Giá vốn',
            'Lãi gộp',
            'Giảm giá',
            'Đơn huỷ',
            'Chốt ngày',
          ]}
          rows={[...rows]
            .reverse()
            .map((r) => [
              dateVi(r.day),
              r.orders,
              r.guests,
              money(r.netRevenue),
              money(r.cost),
              <Signed key="g" v={r.grossProfit} />,
              money(r.discounts),
              r.cancelled ? <Badge tone="bad">{r.cancelled}</Badge> : '0',
              r.closed ? (
                <Signed key="c" v={r.cashDiff ?? 0} lossTag={false} />
              ) : (
                <Badge tone="warn">Chưa chốt</Badge>
              ),
            ])}
          total={[
            'Tổng',
            orders,
            guests,
            money(sum('netRevenue')),
            money(sum('cost')),
            <Signed key="t" v={sum('grossProfit')} />,
            money(sum('discounts')),
            rows.reduce((s, r) => s + r.cancelled, 0),
            '',
          ]}
        />
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- sales breakdown

type View = 'hour' | 'channel' | 'table' | 'staff' | 'method' | 'dish';

export function SalesReportPage() {
  const [range, setRange] = useState<Range>(thisMonthRange);
  const [view, setView] = useState<View>('hour');
  const q = useQuery({
    queryKey: ['report', 'sales', range],
    queryFn: async () => ok(await client.reports.sales({ query: range })),
  });
  const s = q.data;

  const hours = Array.from({ length: 24 }, (_, h) => s?.byHour.find((x) => x.hour === h)).map((x, h) => ({
    h,
    v: Number(x?.netRevenue ?? 0),
    orders: x?.orders ?? 0,
  }));
  const firstHour = hours.findIndex((h) => h.v);
  const lastHour = 23 - [...hours].reverse().findIndex((h) => h.v);
  const shownHours = firstHour < 0 ? [] : hours.slice(firstHour, lastHour + 1);

  const table = (): { head: string[]; rows: (string | number)[][] } => {
    if (!s) return { head: [], rows: [] };
    switch (view) {
      case 'hour':
        return {
          head: ['Giờ', 'Số đơn', 'Doanh thu thuần'],
          rows: shownHours.map((h) => [`${h.h}:00–${h.h + 1}:00`, h.orders, h.v]),
        };
      case 'channel':
        return {
          head: ['Kênh', 'Số đơn', 'Doanh thu thuần'],
          rows: s.byChannel.map((r) => [r.label, r.orders, Number(r.netRevenue)]),
        };
      case 'table':
        return {
          head: ['Khu vực / bàn', 'Số đơn', 'Doanh thu thuần'],
          rows: s.byTable.map((r) => [r.label, r.orders, Number(r.netRevenue)]),
        };
      case 'staff':
        return {
          head: ['Nhân viên thu ngân', 'Số đơn', 'Doanh thu thuần', 'Giảm giá'],
          rows: s.byStaff.map((r) => [r.label, r.orders, Number(r.netRevenue), Number(r.discounts)]),
        };
      case 'method':
        return {
          head: ['Hình thức', 'Lượt', 'Số tiền'],
          rows: s.byMethod.map((r) => [r.label, r.payments, Number(r.amount)]),
        };
      case 'dish':
        return {
          head: ['Món', 'SL', 'Doanh thu thuần'],
          rows: s.topDishes.map((r) => [r.name, r.qty, Number(r.netRevenue)]),
        };
    }
  };
  const t = table();

  return (
    <div>
      <PageHeader
        title="Phân tích bán hàng"
        subtitle="Theo giờ, kênh, bàn, nhân viên, hình thức thanh toán, món bán chạy"
        actions={
          s && (
            <ExportButton
              filename={`ban-hang-${range.from}-${range.to}`}
              title={`Phân tích bán hàng ${dateVi(range.from)} – ${dateVi(range.to)}`}
              sheets={() => [
                {
                  name: 'Bán hàng',
                  columns: t.head.map((h, i) => ({
                    header: h,
                    kind:
                      i === 0 ? 'text' : h.includes('Số đơn') || h === 'SL' || h === 'Lượt' ? 'int' : 'money',
                  })),
                  rows: t.rows,
                },
              ]}
            />
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <RangePicker value={range} onChange={setRange} />
      </div>
      <div className="mb-3 overflow-x-auto">
        <Segmented
          label="Xem theo"
          value={view}
          onChange={setView}
          options={[
            { value: 'hour', label: 'Theo giờ' },
            { value: 'channel', label: 'Kênh' },
            { value: 'table', label: 'Khu vực / bàn' },
            { value: 'staff', label: 'Nhân viên' },
            { value: 'method', label: 'Thanh toán' },
            { value: 'dish', label: 'Món bán chạy' },
          ]}
        />
      </div>
      {s && (
        <Card className="mb-4 p-4">
          {view === 'hour' ? (
            shownHours.length ? (
              <SeriesChart
                ariaLabel="Doanh thu thuần theo giờ"
                labels={shownHours.map((h) => `${h.h}h`)}
                series={[
                  {
                    name: 'Doanh thu thuần',
                    color: SERIES.blue,
                    kind: 'column',
                    values: shownHours.map((h) => h.v),
                  },
                ]}
                format={(v) => money(v)}
                height={200}
              />
            ) : (
              <p className="py-8 text-center text-[13px] text-muted">Chưa có đơn.</p>
            )
          ) : (
            <DivergingBars
              rows={t.rows.slice(0, 15).map((r) => ({ label: String(r[0]), value: Number(r[2]) }))}
              format={(v) => money(v)}
            />
          )}
        </Card>
      )}
      <Card>
        <ReportTable
          head={t.head}
          rows={t.rows.map((r) => r.map((c, i) => (i >= 2 && typeof c === 'number' ? money(c) : c)))}
        />
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- cancellations & discounts

export function CancellationsPage() {
  const [range, setRange] = useState<Range>(thisMonthRange);
  const [tab, setTab] = useState<'orders' | 'items' | 'discounts'>('orders');
  const q = useQuery({
    queryKey: ['report', 'cancellations', range],
    queryFn: async () => ok(await client.reports.cancellations({ query: range })),
  });
  const c = q.data;

  return (
    <div>
      <PageHeader
        title="Đơn & món huỷ, giảm giá"
        subtitle="Để kiểm soát gian lận: ai huỷ, khi nào, lý do; giảm giá nào làm đơn lỗ"
        actions={
          c && (
            <ExportButton
              filename={`huy-giam-gia-${range.from}-${range.to}`}
              title={`Huỷ & giảm giá ${dateVi(range.from)} – ${dateVi(range.to)}`}
              sheets={() => [
                {
                  name: 'Đơn huỷ',
                  columns: [
                    'Mã đơn',
                    'Ngày',
                    'Kênh',
                    'Tiền',
                    'Đã thanh toán',
                    'Lý do',
                    'Người huỷ',
                    'Người duyệt',
                  ].map((h, i) => ({ header: h, kind: i === 3 ? 'money' : 'text' })),
                  rows: c.orders.map((o) => [
                    o.code,
                    dateVi(o.day),
                    CHANNEL[o.channel] ?? o.channel,
                    Number(o.total),
                    o.wasPaid ? 'Có' : 'Chưa',
                    o.reason,
                    o.cancelledBy,
                    o.approvedBy,
                  ]),
                },
                {
                  name: 'Món huỷ',
                  columns: ['Mã đơn', 'Ngày', 'Món', 'SL', 'Tiền', 'Đã chế biến', 'Lý do', 'Người huỷ'].map(
                    (h, i) => ({ header: h, kind: i === 3 ? 'int' : i === 4 ? 'money' : 'text' }),
                  ),
                  rows: c.items.map((i) => [
                    i.code,
                    dateVi(i.day),
                    i.dish,
                    i.qty,
                    Number(i.amount),
                    i.wasted ? 'Có' : 'Không',
                    i.reason,
                    i.cancelledBy,
                  ]),
                },
                {
                  name: 'Giảm giá',
                  columns: [
                    'Mã đơn',
                    'Ngày',
                    'Tạm tính',
                    'Giảm giá',
                    'Doanh thu thuần',
                    'Giá vốn',
                    'Lãi đơn',
                    'Lý do',
                    'Thu ngân',
                    'Người duyệt',
                  ].map((h, i) => ({ header: h, kind: i >= 2 && i <= 6 ? 'money' : 'text' })),
                  rows: c.discounts.map((d) => [
                    d.code,
                    dateVi(d.day),
                    Number(d.subtotal),
                    Number(d.discount),
                    Number(d.netRevenue),
                    Number(d.cost),
                    Number(d.profit),
                    d.reason,
                    d.paidBy,
                    d.approvedBy,
                  ]),
                },
              ]}
            />
          )
        }
      />
      <div className="mb-4">
        <RangePicker value={range} onChange={setRange} />
      </div>
      {c && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Đơn huỷ"
              value={c.orders.length}
              sub={`${c.orders.filter((o) => o.wasPaid).length} đơn huỷ sau thanh toán`}
            />
            <StatCard
              label="Món huỷ"
              value={c.items.reduce((s, i) => s + i.qty, 0)}
              sub={`${c.items.filter((i) => i.wasted).length} dòng đã chế biến`}
            />
            <StatCard
              label="Tổng giảm giá"
              value={money(c.discounts.reduce((s, d) => s + Number(d.discount), 0))}
              sub={`${c.discounts.length} đơn`}
            />
            <StatCard
              label="Đơn giảm giá bị lỗ"
              value={c.discounts.filter((d) => Number(d.profit) < 0).length}
              tone={c.discounts.some((d) => Number(d.profit) < 0) ? 'bad' : undefined}
            />
          </div>
          <div className="mb-3">
            <Segmented
              label="Danh sách"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'orders', label: `Đơn huỷ (${c.orders.length})` },
                { value: 'items', label: `Món huỷ (${c.items.length})` },
                { value: 'discounts', label: `Giảm giá (${c.discounts.length})` },
              ]}
            />
          </div>
          <Card>
            {tab === 'orders' && (
              <ReportTable
                head={['Mã đơn', 'Lúc huỷ', 'Kênh', 'Tiền', 'Thời điểm', 'Lý do', 'Người huỷ', 'Duyệt']}
                align={['l', 'l', 'l', 'r', 'l', 'l', 'l', 'l']}
                minWidth={900}
                rows={c.orders.map((o) => [
                  o.code,
                  time(o.cancelledAt),
                  CHANNEL[o.channel] ?? o.channel,
                  money(o.total),
                  o.wasPaid ? <Badge tone="bad">Sau thanh toán</Badge> : <Badge>Trước thanh toán</Badge>,
                  o.reason ?? '',
                  o.cancelledBy ?? '',
                  o.approvedBy ?? '',
                ])}
              />
            )}
            {tab === 'items' && (
              <ReportTable
                head={['Mã đơn', 'Lúc huỷ', 'Món', 'SL', 'Tiền', 'Đã chế biến', 'Lý do', 'Người huỷ']}
                align={['l', 'l', 'l', 'r', 'r', 'l', 'l', 'l']}
                minWidth={900}
                rows={c.items.map((i) => [
                  i.code,
                  time(i.cancelledAt),
                  i.dish,
                  i.qty,
                  money(i.amount),
                  i.wasted ? <Badge tone="warn">Có</Badge> : 'Không',
                  i.reason ?? '',
                  i.cancelledBy ?? '',
                ])}
              />
            )}
            {tab === 'discounts' && (
              <ReportTable
                head={[
                  'Mã đơn',
                  'Ngày',
                  'Tạm tính',
                  'Giảm giá',
                  'DT thuần',
                  'Giá vốn',
                  'Lãi đơn sau giảm',
                  'Lý do',
                  'Thu ngân',
                  'Duyệt',
                ]}
                align={['l', 'l', 'r', 'r', 'r', 'r', 'r', 'l', 'l', 'l']}
                minWidth={1000}
                rows={c.discounts.map((d) => [
                  d.code,
                  dateVi(d.day),
                  money(d.subtotal),
                  money(d.discount),
                  money(d.netRevenue),
                  money(d.cost),
                  <Signed key="p" v={d.profit} />,
                  d.reason ?? '',
                  d.paidBy ?? '',
                  d.approvedBy ?? '',
                ])}
              />
            )}
          </Card>
        </>
      )}
    </div>
  );
}
