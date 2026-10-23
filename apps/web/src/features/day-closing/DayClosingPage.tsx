import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { AlertTriangle, CheckCircle2, Lock } from 'lucide-react';
import type { DayClosingDto } from '@ketoan/api/contracts';
import { businessDateOf } from '@ketoan/api/domain';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge, Card } from '@/components/ui/controls';
import { DataTable } from '@/components/ui/DataTable';
import { useToast } from '@/components/ui/Toast';
import { FormError } from '@/auth/AuthCard';
import { client, errorMessage, ok } from '@/lib/api-client';
import { dateVi, money } from '@/lib/format';
import { cn } from '@/lib/cn';
import { posKeys, usePosSettings } from '@/pos/data';
import { DateInput } from '@/components/DateInput';

const METHOD = { CASH: 'Tiền mặt', TRANSFER: 'Chuyển khoản', CARD: 'Thẻ', APP: 'App giao hàng' } as const;

export function DayClosingPage({ inPos = false }: { inPos?: boolean }) {
  const settings = usePosSettings().data?.settings;
  const [date, setDate] = useState('');
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();

  useEffect(() => {
    if (settings && !date) setDate(businessDateOf(new Date(), settings.business_day_start));
  }, [settings, date]);

  const preview = useQuery({
    queryKey: posKeys.day(date),
    queryFn: async () => ok(await client.dayClosing.preview({ params: { date } })),
    enabled: !!date,
  });
  const month = date.slice(0, 7);
  const history = useQuery({
    queryKey: ['pos', 'closings', month],
    queryFn: async () => ok(await client.dayClosing.list({ query: { month } })),
    enabled: !!month,
  });
  const p = preview.data;

  useEffect(() => {
    setCounted(p?.closing ? String(Number(p.closing.countedCash)) : '');
    setNote(p?.closing?.note ?? '');
    setError(null);
  }, [p?.businessDate, p?.closing]);

  const diff = counted === '' || !p ? null : Number(counted) - Number(p.expectedCash);

  const close = async () => {
    setBusy(true);
    setError(null);
    try {
      ok(
        await client.dayClosing.close({
          params: { date },
          body: { countedCash: counted || '0', note: note.trim() || null },
        }),
      );
      toast(`Đã chốt ngày ${dateVi(date)}`);
      qc.invalidateQueries({ queryKey: posKeys.day(date) });
      qc.invalidateQueries({ queryKey: ['pos', 'closings'] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={inPos ? 'h-full overflow-y-auto p-3' : ''}>
      <PageHeader
        title="Chốt ngày"
        subtitle="Đếm tiền mặt cuối ngày và đối chiếu với số máy tính"
        actions={
          <DateInput
            aria-label="Ngày kinh doanh"
            value={date}
            onChange={(v) => setDate(v)}
            className="w-44"
          />
        }
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          {p && p.openOrders > 0 && (
            <p className="flex items-center gap-2 rounded-ctl bg-warn-soft px-3 py-2 text-[13px] text-warn">
              <AlertTriangle size={16} /> Còn {p.openOrders} đơn chưa thanh toán — thanh toán hoặc huỷ trước
              khi chốt.
            </p>
          )}
          {p?.closing?.needsReclose && (
            <p className="flex items-center gap-2 rounded-ctl bg-warn-soft px-3 py-2 text-[13px] text-warn">
              <AlertTriangle size={16} /> Có thay đổi sau khi chốt (huỷ đơn, sổ quỹ) — cần chốt lại.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Đơn thanh toán" value={String(p?.paidOrders ?? '—')} />
            <Stat label="Đơn huỷ" value={String(p?.cancelledOrders ?? '—')} />
            <Stat label="Doanh thu thuần" value={p ? money(p.netRevenue) : '—'} />
            <Stat label="Khách đã trả (gồm VAT)" value={p ? money(p.total) : '—'} />
          </div>
          <Card>
            <h2 className="border-b border-line px-4 py-3 font-semibold">Theo hình thức thanh toán</h2>
            <table className="w-full text-sm">
              <tbody>
                {(Object.keys(METHOD) as (keyof typeof METHOD)[]).map((m) => (
                  <tr key={m} className="border-b border-[#f2f4f7]">
                    <td className="px-4 py-2.5">{METHOD[m]}</td>
                    <td className="num px-4 py-2.5 text-right">{p ? money(p.byMethod[m]) : '—'}</td>
                  </tr>
                ))}
                <tr className="bg-total-row font-semibold">
                  <td className="px-4 py-2.5">Tổng</td>
                  <td className="num px-4 py-2.5 text-right">{p ? money(p.total) : '—'}</td>
                </tr>
              </tbody>
            </table>
          </Card>
        </div>

        <Card className="flex flex-col gap-3 p-4">
          <h2 className="flex items-center justify-between font-semibold">
            Đếm tiền mặt
            {p?.closing && (
              <Badge tone={p.closing.needsReclose ? 'warn' : 'good'}>
                {p.closing.needsReclose
                  ? 'Cần chốt lại'
                  : `Đã chốt ${new Date(p.closing.closedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`}
              </Badge>
            )}
          </h2>
          <dl className="flex flex-col gap-1 text-[13px] text-muted">
            <div className="flex justify-between">
              <dt>Tiền mặt bán hàng (thu − thối)</dt>
              <dd className="num">{p ? money(p.cashSales) : '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt>+ Thu vào két (sổ quỹ)</dt>
              <dd className="num">{p ? money(p.cashIn) : '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt>− Chi từ két (sổ quỹ)</dt>
              <dd className="num">{p ? money(p.cashOut) : '—'}</dd>
            </div>
            <div className="flex justify-between border-t border-line pt-1">
              <dt className="font-medium text-ink">Tiền mặt dự kiến</dt>
              <dd className="num font-semibold text-ink">{p ? money(p.expectedCash) : '—'}</dd>
            </div>
          </dl>
          <Link
            to={inPos ? '/pos/cash' : '/admin/accounting/cash'}
            className="-mt-1 self-end text-[13px] text-primary-ink hover:underline"
          >
            Mở sổ quỹ
          </Link>
          <label className="flex flex-col gap-1.5 text-[13px] font-medium">
            Tiền mặt đếm được
            <Input
              inputMode="numeric"
              className="num h-12 text-right text-lg font-bold"
              value={counted ? money(counted) : ''}
              onChange={(e) => setCounted(e.target.value.replace(/\D/g, ''))}
              placeholder="0"
            />
          </label>
          {diff !== null && (
            <div
              className={cn(
                'flex items-center justify-between rounded-ctl px-3 py-2 text-sm font-semibold',
                diff === 0
                  ? 'bg-good-soft text-good'
                  : diff < 0
                    ? 'bg-bad-soft text-bad-ink'
                    : 'bg-warn-soft text-warn',
              )}
            >
              <span className="flex items-center gap-1.5">
                {diff === 0 ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                {diff === 0 ? 'Khớp' : diff < 0 ? 'Thiếu' : 'Thừa'}
              </span>
              <span className="num">{money(diff)}</span>
            </div>
          )}
          <label className="flex flex-col gap-1.5 text-[13px] font-medium">
            Ghi chú {diff ? '(nên ghi lý do chênh lệch)' : ''}
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="rounded-ctl border border-field px-3 py-2 text-sm font-normal"
            />
          </label>
          <FormError message={error} />
          <Button
            variant="primary"
            size="lg"
            icon={<Lock size={18} />}
            loading={busy}
            disabled={!p || p.openOrders > 0 || counted === ''}
            onClick={close}
          >
            {p?.closing ? 'Chốt lại ngày' : 'Chốt ngày'}
          </Button>
        </Card>
      </div>

      <Card className="mt-4">
        <h2 className="border-b border-line px-4 py-3 font-semibold">
          Lịch sử chốt tháng {month.split('-').reverse().join('/')}
        </h2>
        <DataTable<DayClosingDto>
          rows={history.data}
          loading={history.isLoading}
          rowKey={(r) => r.businessDate}
          onRowClick={(r) => setDate(r.businessDate)}
          columns={[
            { key: 'd', header: 'Ngày', cell: (r) => dateVi(r.businessDate) },
            {
              key: 'e',
              header: 'Dự kiến',
              align: 'right',
              cell: (r) => <span className="num">{money(r.expectedCash)}</span>,
            },
            {
              key: 'c',
              header: 'Đếm được',
              align: 'right',
              cell: (r) => <span className="num">{money(r.countedCash)}</span>,
            },
            {
              key: 'diff',
              header: 'Chênh lệch',
              align: 'right',
              cell: (r) => (
                <span
                  className={cn(
                    'num font-semibold',
                    Number(r.diff) < 0 ? 'text-bad' : Number(r.diff) > 0 ? 'text-warn' : 'text-good',
                  )}
                >
                  {money(r.diff)}
                </span>
              ),
            },
            { key: 'by', header: 'Người chốt', cell: (r) => r.closedByName, secondary: true },
            {
              key: 'n',
              header: 'Ghi chú',
              cell: (r) => (r.needsReclose ? <Badge tone="warn">Cần chốt lại</Badge> : (r.note ?? '')),
              secondary: true,
            },
          ]}
          empty={<p className="py-8 text-center text-[13px] text-muted">Chưa chốt ngày nào trong tháng.</p>}
        />
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <span className="text-[13px] text-muted">{label}</span>
      <span className="num text-xl font-bold text-ink-strong">{value}</span>
    </Card>
  );
}

export const PosDayClosingPage = () => <DayClosingPage inPos />;
