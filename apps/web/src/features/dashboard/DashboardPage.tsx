import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { AlertList, alertItems, useDashboard } from '@/components/alerts';
import { SetupChecklist } from './SetupChecklist';
import { Card } from '@/components/ui/controls';
import { SERIES, SeriesChart } from '@/components/charts/Charts';
import { Signed, StatCard, StatusBadges } from '@/components/report';
import { useRealtime } from '@/lib/socket';
import { dateVi, money } from '@/lib/format';

export function DashboardPage() {
  const qc = useQueryClient();
  const q = useDashboard();
  // Today's revenue moves as tills take payments.
  useRealtime({ 'order:update': () => qc.invalidateQueries({ queryKey: ['dashboard'] }) });
  const d = q.data;
  if (!d) return <PageHeader title="Bảng điều khiển" />;

  // Compare with yesterday only once today has sales (early morning "−100%" is just noise).
  const change =
    d.todayOrders > 0 && Number(d.yesterdayNetRevenue)
      ? ((Number(d.todayNetRevenue) - Number(d.yesterdayNetRevenue)) / Number(d.yesterdayNetRevenue)) * 100
      : null;
  const alerts = alertItems(d);

  return (
    <div>
      <PageHeader
        title="Bảng điều khiển"
        subtitle={`Hôm nay ${dateVi(d.today)} · tự cập nhật khi có đơn thanh toán`}
      />
      <SetupChecklist setup={d.setup} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Doanh thu thuần hôm nay"
          value={money(d.todayNetRevenue)}
          sub={
            change === null
              ? `${d.todayOrders} đơn · ${d.todayGuests} khách`
              : `${change >= 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(0)}% so với hôm qua · ${d.todayOrders} đơn`
          }
        />
        <StatCard label="Lãi gộp hôm nay (tạm tính)" value={<Signed v={d.todayGrossProfit} />} />
        <StatCard
          label="Đang phục vụ"
          value={`${d.tablesInUse}/${d.tablesTotal} bàn`}
          sub={`${d.openOrders} đơn đang mở`}
        />
        <StatCard
          label={`${d.monthProfitAfterTax !== null ? 'Lợi nhuận sau thuế' : 'Lợi nhuận ròng'} tháng ${d.month.slice(5)}/${d.month.slice(0, 4)}`}
          value={<Signed v={d.monthProfitAfterTax ?? d.monthNetProfit} />}
          tone={Number(d.monthProfitAfterTax ?? d.monthNetProfit) < 0 ? 'bad' : undefined}
          sub={<StatusBadges statuses={d.monthStatuses} />}
        />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="p-4">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="font-semibold">30 ngày gần nhất</h2>
              <Link to="/admin/reports/daily" className="text-[13px] text-primary-ink">
                Chi tiết <ArrowRight size={14} className="inline" />
              </Link>
            </div>
            <SeriesChart
              ariaLabel="Doanh thu thuần và lãi gộp 30 ngày gần nhất"
              labels={d.last30.map((x) => `${x.day.slice(8)}/${x.day.slice(5, 7)}`)}
              series={[
                {
                  name: 'Doanh thu thuần',
                  color: SERIES.blue,
                  kind: 'line',
                  values: d.last30.map((x) => Number(x.netRevenue)),
                },
                {
                  name: 'Lãi gộp',
                  color: SERIES.orange,
                  kind: 'line',
                  values: d.last30.map((x) => Number(x.grossProfit)),
                },
              ]}
              format={(v) => money(v)}
              tickEvery={5}
            />
          </Card>
          <Card className="p-4">
            <h2 className="mb-3 font-semibold">Hôm nay theo giờ</h2>
            {d.byHourToday.length ? (
              <SeriesChart
                ariaLabel="Doanh thu thuần hôm nay theo giờ"
                labels={d.byHourToday.map((h) => `${h.hour}h`)}
                series={[
                  {
                    name: 'Doanh thu thuần',
                    color: SERIES.blue,
                    kind: 'column',
                    values: d.byHourToday.map((h) => Number(h.netRevenue)),
                  },
                ]}
                format={(v) => money(v)}
                height={160}
              />
            ) : (
              <p className="py-6 text-center text-[13px] text-muted">Chưa có đơn thanh toán hôm nay.</p>
            )}
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          <Card className="p-4">
            <h2 className="mb-2 font-semibold">Cần chú ý</h2>
            <AlertList items={alerts} />
          </Card>
          <Card className="p-4">
            <h2 className="mb-2 font-semibold">Bán chạy tháng này</h2>
            {d.topDishes.map((t, i) => (
              <div key={t.name} className="flex items-center gap-3 py-1.5 text-[13px]">
                <span className="w-4 text-faint">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{t.name}</span>
                <span className="num text-muted">{t.qty} phần</span>
                <span className="num w-24 text-right font-semibold">{money(t.netRevenue)}</span>
              </div>
            ))}
            {d.topDishes.length === 0 && <p className="text-[13px] text-muted">Chưa có.</p>}
          </Card>
          <Card className="p-4 text-[13px]">
            <h2 className="mb-2 font-semibold">Tháng này (tạm tính)</h2>
            <div className="flex justify-between py-1">
              <span className="text-muted">Doanh thu thuần</span>
              <span className="num">{money(d.monthNetRevenue)}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-muted">Lãi gộp</span>
              <Signed v={d.monthGrossProfit} />
            </div>
            {d.monthProfitAfterTax !== null ? (
              <>
                <div className="flex justify-between py-1">
                  <span className="text-muted">Lợi nhuận trước thuế</span>
                  <Signed v={d.monthNetProfit} />
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted">Thuế (tạm tính)</span>
                  <span className="num">
                    {money(Number(d.monthNetProfit) - Number(d.monthProfitAfterTax))}
                  </span>
                </div>
                <div className="flex justify-between py-1 font-semibold">
                  <span>Lợi nhuận sau thuế</span>
                  <Signed v={d.monthProfitAfterTax} />
                </div>
              </>
            ) : (
              <div className="flex justify-between py-1 font-semibold">
                <span>Lợi nhuận ròng</span>
                <Signed v={d.monthNetProfit} />
              </div>
            )}
            <Link to="/admin/reports/pnl" className="mt-2 inline-block text-primary-ink">
              Xem báo cáo lãi lỗ <ArrowRight size={14} className="inline" />
            </Link>
          </Card>
        </div>
      </div>
    </div>
  );
}
