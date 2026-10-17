import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import type { MonthPnl, RangePnl } from '@ketoan/api/contracts';
import { PageHeader } from '@/components/PageHeader';
import { MonthPicker, thisMonth } from '@/components/MonthPicker';
import { Card, Segmented } from '@/components/ui/controls';
import { SERIES, SeriesChart } from '@/components/charts/Charts';
import { ExportButton, Signed, StatCard, StatusBadges, STATUS_META, pctText } from '@/components/report';
import { client, ok } from '@/lib/api-client';
import { money } from '@/lib/format';
import { cn } from '@/lib/cn';

const CHANNEL: Record<string, string> = { DINE_IN: 'Tại bàn', TAKEAWAY: 'Mang về', APP: 'App giao hàng' };
const METHOD: Record<string, string> = {
  CASH: 'Tiền mặt',
  TRANSFER: 'Chuyển khoản',
  CARD: 'Thẻ',
  APP: 'App',
};
const monthVi = (m: string) => `${m.slice(5)}/${m.slice(0, 4)}`;

/**
 * A deduction line is printed with a minus; a negative deduction (e.g. stocktake surplus) is a gain and prints "+".
 * Subtotals keep their own sign.
 */
const lineAmount = (amount: string, deduct: boolean) => {
  const n = Number(amount);
  if (!deduct || n === 0) return money(n);
  return n > 0 ? `−${money(n)}` : `+${money(-n)}`;
};

// ---------------------------------------------------------------- one month

export function PnlMonthPage() {
  const [month, setMonth] = useState(thisMonth);
  const q = useQuery({
    queryKey: ['report', 'pnl', month],
    queryFn: async () => ok(await client.reports.pnlMonth({ params: { month } })),
  });
  const p = q.data;
  const get = (k: string) => p?.lines.find((l) => l.key === k);

  return (
    <div>
      <PageHeader
        title="Lãi lỗ tháng"
        subtitle="Báo cáo gốc: quý và năm là tổng các tháng. Tháng đã khoá sổ hiển thị số đã chốt."
        actions={
          <>
            <MonthPicker value={month} onChange={setMonth} />
            {p && (
              <ExportButton
                filename={`lai-lo-${month}`}
                title={`Lãi lỗ tháng ${monthVi(month)}`}
                sheets={() => [pnlSheet(p)]}
              />
            )}
          </>
        }
      />
      {p && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <StatusBadges statuses={p.statuses} />
            {p.statuses
              .filter((s) => s !== 'PROVISIONAL' && s !== 'CLOSED')
              .map((s) => (
                <span key={s} className="flex items-center gap-1.5 text-[13px] text-warn">
                  <AlertTriangle size={14} /> {STATUS_META[s].hint}
                </span>
              ))}
          </div>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Doanh thu thuần"
              value={money(get('netRevenue')!.amount)}
              sub={`${p.kpis.orders} đơn · TB ${money(p.kpis.avgPerOrder)}/đơn`}
            />
            <StatCard
              label="Lãi gộp"
              value={<Signed v={get('grossProfit')!.amount} />}
              sub={`Food cost ${pctText(p.kpis.foodCostPct)}`}
            />
            <StatCard
              label="Lợi nhuận sau kiểm kê"
              value={<Signed v={get('profitAfterStocktake')!.amount} />}
              sub={`Hao hụt ${money(get('stocktakeLoss')!.amount)}`}
            />
            {get('profitAfterTax') ? (
              <StatCard
                label="Lợi nhuận sau thuế"
                value={<Signed v={get('profitAfterTax')!.amount} />}
                tone={Number(get('profitAfterTax')!.amount) < 0 ? 'bad' : undefined}
                sub={`Trước thuế ${money(get('netProfit')!.amount)} · thuế tạm tính ${money(
                  Number(get('taxVat')!.amount) + Number(get('taxPit')!.amount),
                )}`}
              />
            ) : (
              <StatCard
                label="Lợi nhuận ròng"
                value={<Signed v={get('netProfit')!.amount} />}
                tone={Number(get('netProfit')!.amount) < 0 ? 'bad' : undefined}
                sub={`${pctText(get('netProfit')!.pct)} doanh thu thuần`}
              />
            )}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <Card className="min-w-0">
              <div
                tabIndex={0}
                role="region"
                aria-label="Bảng, cuộn ngang để xem thêm cột"
                className="overflow-x-auto"
              >
                <table className="w-full min-w-[820px] text-sm">
                  <thead>
                    <tr className="bg-primary-soft text-[13px] text-ink-strong">
                      <th className="w-10 px-3 py-2.5 text-left font-semibold">#</th>
                      <th className="px-3 py-2.5 text-left font-semibold">Chỉ tiêu</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Tháng {monthVi(month)}</th>
                      <th className="px-3 py-2.5 text-right font-semibold">% DT thuần</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Tháng trước</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Chênh lệch</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Luỹ kế năm</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.lines.map((l) => (
                      <tr
                        key={l.key}
                        className={cn(
                          'border-b border-[#f2f4f7]',
                          l.total && 'bg-total-row font-semibold',
                          l.child && 'text-[13px] text-muted',
                        )}
                      >
                        <td className="px-3 py-2 text-faint">{l.no}</td>
                        <td className={cn('whitespace-nowrap px-3 py-2', l.child && 'pl-8')}>{l.label}</td>
                        <td className="num px-3 py-2 text-right">
                          {l.total ? <Signed v={l.amount} strong /> : lineAmount(l.amount, l.deduct)}
                        </td>
                        <td className="num px-3 py-2 text-right text-muted">
                          {l.child ? '' : pctText(l.pct)}
                        </td>
                        <td className="num px-3 py-2 text-right text-muted">
                          {l.total ? (
                            <Signed v={l.previous} lossTag={false} />
                          ) : (
                            lineAmount(l.previous, l.deduct)
                          )}
                        </td>
                        <td className="num px-3 py-2 text-right">
                          <Delta v={l.diff} good={!l.deduct} />
                        </td>
                        <td className="num px-3 py-2 text-right">
                          {l.total ? <Signed v={l.ytd} lossTag={false} /> : lineAmount(l.ytd, l.deduct)}
                        </td>
                      </tr>
                    ))}
                    <tr className="text-[13px] text-muted">
                      <td />
                      <td className="px-3 py-2 italic">
                        VAT đã thu (ghi nhớ — tiền thuế phải nộp, không phải doanh thu)
                      </td>
                      <td className="num px-3 py-2 text-right">{money(p.kpis.vatCollected)}</td>
                      <td colSpan={4} />
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>
            <div className="flex flex-col gap-4">
              <MiniTable
                title="Doanh thu thuần theo kênh"
                rows={Object.entries(p.kpis.netByChannel).map(([k, v]) => [CHANNEL[k] ?? k, v])}
              />
              <MiniTable
                title="Theo hình thức thanh toán"
                rows={Object.entries(p.kpis.byMethod).map(([k, v]) => [METHOD[k] ?? k, v])}
              />
              <Card className="p-4 text-[13px]">
                <h3 className="mb-2 font-semibold">Kho & tiền mặt</h3>
                <KV k="Tồn kho đầu tháng" v={money(p.kpis.stockStart)} />
                <KV k="Tiền nhập hàng" v={money(p.kpis.purchases)} />
                <KV k="Trả nhà cung cấp" v={money(p.kpis.supplierReturns)} />
                <KV k="Tồn kho cuối tháng" v={money(p.kpis.stockEnd)} />
                <KV k="Cân đối kho (lệch làm tròn)" v={money(p.kpis.stockBalanceGap)} />
                <KV k="Chênh lệch tiền mặt chốt ngày" v={<Signed v={p.kpis.cashDiff} lossTag={false} />} />
                <KV k="Số khách" v={String(p.kpis.guests)} />
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function pnlSheet(p: MonthPnl) {
  return {
    name: `Lai lo ${p.month}`,
    columns: [
      { header: '#', kind: 'text' as const },
      { header: 'Chỉ tiêu', kind: 'text' as const },
      { header: 'Số tiền', kind: 'money' as const },
      { header: '% DT thuần', kind: 'pct' as const },
      { header: 'Tháng trước', kind: 'money' as const },
      { header: 'Chênh lệch', kind: 'money' as const },
      { header: 'Luỹ kế năm', kind: 'money' as const },
    ],
    rows: p.lines.map((l) => {
      const s = l.deduct ? -1 : 1;
      return [
        l.no,
        l.child ? `   ${l.label}` : l.label,
        s * Number(l.amount),
        l.pct === null ? null : Number(l.pct),
        s * Number(l.previous),
        s * Number(l.diff),
        s * Number(l.ytd),
      ];
    }),
    bold: p.lines.flatMap((l, i) => (l.total ? [i] : [])),
  };
}

function Delta({ v, good }: { v: string; good: boolean }) {
  const n = Number(v);
  if (!n) return <span className="text-faint">—</span>;
  const better = good ? n > 0 : n < 0;
  return (
    <span className={cn('whitespace-nowrap', better ? 'text-good' : 'text-warn')}>
      {n > 0 ? '▲' : '▼'} {money(Math.abs(n))}
    </span>
  );
}

const KV = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex justify-between gap-3 py-1">
    <span className="text-muted">{k}</span>
    <span className="num">{v}</span>
  </div>
);

function MiniTable({ title, rows }: { title: string; rows: [string, string][] }) {
  const total = rows.reduce((s, [, v]) => s + Number(v), 0);
  return (
    <Card className="p-4 text-[13px]">
      <h3 className="mb-2 font-semibold">{title}</h3>
      {rows.length === 0 && <p className="text-muted">Chưa có.</p>}
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center gap-3 py-1">
          <span className="w-28 shrink-0 text-muted">{k}</span>
          <span className="h-2 min-w-0 flex-1 rounded-r-[4px] bg-track">
            <span
              className="block h-full rounded-r-[4px]"
              style={{ width: `${total ? (Number(v) / total) * 100 : 0}%`, background: SERIES.blue }}
            />
          </span>
          <span className="num w-24 text-right">{money(v)}</span>
        </div>
      ))}
    </Card>
  );
}

// ---------------------------------------------------------------- quarter / year

type Mode = 'Q' | 'Y';

export function PnlRangePage() {
  const now = thisMonth();
  const [mode, setMode] = useState<Mode>('Q');
  const [year, setYear] = useState(Number(now.slice(0, 4)));
  const [quarter, setQuarter] = useState(Math.ceil(Number(now.slice(5)) / 3));
  const from = mode === 'Y' ? `${year}-01` : `${year}-${String((quarter - 1) * 3 + 1).padStart(2, '0')}`;
  const to = mode === 'Y' ? `${year}-12` : `${year}-${String(quarter * 3).padStart(2, '0')}`;
  const q = useQuery({
    queryKey: ['report', 'pnl-range', from, to],
    queryFn: async () => ok(await client.reports.pnlRange({ query: { from, to } })),
  });
  const r = q.data;
  const title = mode === 'Y' ? `Năm ${year}` : `Quý ${quarter}/${year}`;

  return (
    <div>
      <PageHeader
        title="Lãi lỗ quý / năm"
        subtitle="Mỗi tháng một cột, cột cuối là tổng. Tháng đã khoá lấy số đã chốt."
        actions={
          <>
            <Segmented
              label="Kỳ"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'Q', label: 'Quý' },
                { value: 'Y', label: 'Năm' },
              ]}
            />
            <div className="inline-flex h-9 items-center rounded-ctl border border-field bg-white">
              <button
                aria-label="Kỳ trước"
                className="inline-flex size-9 items-center justify-center text-muted"
                onClick={() =>
                  mode === 'Y' || quarter === 1
                    ? (setYear(year - 1), mode === 'Q' && setQuarter(4))
                    : setQuarter(quarter - 1)
                }
              >
                <ChevronLeft size={16} />
              </button>
              <span className="w-24 text-center text-sm font-semibold">{title}</span>
              <button
                aria-label="Kỳ sau"
                className="inline-flex size-9 items-center justify-center text-muted"
                onClick={() =>
                  mode === 'Y' || quarter === 4
                    ? (setYear(year + 1), mode === 'Q' && setQuarter(1))
                    : setQuarter(quarter + 1)
                }
              >
                <ChevronRight size={16} />
              </button>
            </div>
            {r && (
              <ExportButton
                filename={`lai-lo-${from}-${to}`}
                title={`Lãi lỗ ${title}`}
                sheets={() => [rangeSheet(r, title)]}
              />
            )}
          </>
        }
      />
      {r && (
        <>
          <Card className="mb-4 p-4">
            <h2 className="mb-3 font-semibold">
              Doanh thu thuần và {r.profitAfterTax ? 'lợi nhuận sau thuế' : 'lợi nhuận ròng'} theo tháng
            </h2>
            <SeriesChart
              ariaLabel={`Doanh thu thuần và ${r.profitAfterTax ? 'lợi nhuận sau thuế' : 'lợi nhuận ròng'} ${title}`}
              labels={r.months.map((m) => `T${Number(m.month.slice(5))}`)}
              series={[
                {
                  name: 'Doanh thu thuần',
                  color: SERIES.blue,
                  kind: 'column',
                  values: r.netRevenue.map(Number),
                },
                {
                  name: r.profitAfterTax ? 'Lợi nhuận sau thuế' : 'Lợi nhuận ròng',
                  color: SERIES.orange,
                  kind: 'line',
                  values: (r.profitAfterTax ?? r.netProfit).map(Number),
                },
              ]}
              format={(v) => money(v)}
              height={220}
            />
          </Card>
          <Card>
            <div
              tabIndex={0}
              role="region"
              aria-label="Bảng, cuộn ngang để xem thêm cột"
              className="overflow-x-auto"
            >
              <table className="w-full text-sm" style={{ minWidth: 260 + r.months.length * 120 }}>
                <thead>
                  <tr className="bg-primary-soft text-[13px] text-ink-strong">
                    <th className="sticky left-0 bg-primary-soft px-3 py-2.5 text-left font-semibold">
                      Chỉ tiêu
                    </th>
                    {r.months.map((m) => (
                      <th key={m.month} className="px-3 py-2.5 text-right align-top font-semibold">
                        T{Number(m.month.slice(5))}/{m.month.slice(0, 4)}
                        <div className="mt-1 flex justify-end">
                          <StatusBadges
                            statuses={m.statuses.filter(
                              (s) => s !== 'PROVISIONAL' || m.statuses.length === 1,
                            )}
                          />
                        </div>
                      </th>
                    ))}
                    <th className="px-3 py-2.5 text-right font-semibold">Tổng</th>
                  </tr>
                </thead>
                <tbody>
                  {r.rows.map((row) => (
                    <tr
                      key={row.key}
                      className={cn(
                        'border-b border-[#f2f4f7]',
                        row.total && 'bg-total-row font-semibold',
                        row.child && 'text-[13px] text-muted',
                      )}
                    >
                      <td
                        className={cn(
                          'sticky left-0 bg-inherit px-3 py-2',
                          row.child ? 'pl-8' : '',
                          row.total ? 'bg-total-row' : 'bg-white',
                        )}
                      >
                        {row.no && <span className="mr-2 text-faint">{row.no}</span>}
                        {row.label}
                      </td>
                      {row.amounts.map((a, i) => (
                        <td key={i} className="num px-3 py-2 text-right">
                          {row.total ? <Signed v={a} lossTag={false} /> : lineAmount(a, row.deduct)}
                        </td>
                      ))}
                      <td className="num px-3 py-2 text-right font-semibold">
                        {row.total ? <Signed v={row.sum} /> : lineAmount(row.sum, row.deduct)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function rangeSheet(r: RangePnl, title: string) {
  return {
    name: title.replace('/', '-'),
    columns: [
      { header: 'Chỉ tiêu', kind: 'text' as const },
      ...r.months.map((m) => ({
        header: `T${m.month.slice(5)}/${m.month.slice(0, 4)}`,
        kind: 'money' as const,
      })),
      { header: 'Tổng', kind: 'money' as const },
    ],
    rows: r.rows.map((row) => {
      const s = row.deduct ? -1 : 1;
      return [
        `${row.no ? row.no + '. ' : '   '}${row.label}`,
        ...row.amounts.map((a) => s * Number(a)),
        s * Number(row.sum),
      ];
    }),
    bold: r.rows.flatMap((row, i) => (row.total ? [i] : [])),
  };
}
