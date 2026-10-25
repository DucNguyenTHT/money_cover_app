import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCw, Send } from 'lucide-react';
import type { EInvoiceDto } from '@ketoan/api/contracts';
import type { EInvoiceStatus } from '@ketoan/api/domain';
import { PageHeader } from '@/components/PageHeader';
import { RangePicker, type Range } from '@/components/report';
import { EINVOICE_STATUS } from '@/components/EInvoiceParts';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, Card, EmptyState, Segmented } from '@/components/ui/controls';
import { DataTable } from '@/components/ui/DataTable';
import { useToast } from '@/components/ui/Toast';
import { client, errorMessage, ok } from '@/lib/api-client';
import { useBusinessToday } from '@/lib/business-date';
import { money } from '@/lib/format';

type Filter = 'ALL' | EInvoiceStatus;
const time = (iso: string) => {
  const d = new Date(Date.parse(iso) + 7 * 3600_000).toISOString();
  return `${d.slice(8, 10)}/${d.slice(5, 7)} ${d.slice(11, 16)}`;
};

/** Kế toán › Hoá đơn điện tử: every invoice sent for the orders of a period, failures to send again. */
export function EInvoicesPage() {
  const today = useBusinessToday();
  const qc = useQueryClient();
  const toast = useToast();
  const [picked, setPicked] = useState<Range | null>(null);
  const range = picked ?? { from: today, to: today };
  const [filter, setFilter] = useState<Filter>('ALL');
  const cfg = useQuery({
    queryKey: ['einvoice', 'config'],
    queryFn: async () => ok(await client.einvoice.config()),
  });
  const list = useQuery({
    queryKey: ['einvoice', 'list', range.from, range.to],
    queryFn: async () => ok(await client.einvoice.list({ query: range })),
    enabled: !!cfg.data?.configured,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['einvoice'] });
  const send = useMutation({
    mutationFn: async () => ok(await client.einvoice.process({ body: {} })),
    onSuccess: (r) => {
      refresh();
      toast(r.waiting ? `Còn ${r.waiting} hoá đơn đang chờ` : 'Không còn hoá đơn nào chờ');
    },
    onError: (e) => toast(errorMessage(e), 'bad'),
  });
  const retry = useMutation({
    mutationFn: async (r: EInvoiceDto) => ok(await client.einvoice.retry({ params: { id: r.id }, body: {} })),
    onSuccess: (r) => {
      refresh();
      toast(r.status === 'ISSUED' ? `Đã phát hành số ${r.invoiceNo ?? ''}` : (r.lastError ?? 'Đã gửi lại'));
    },
    onError: (e) => toast(errorMessage(e), 'bad'),
  });

  const c = cfg.data;
  if (c && !c.configured)
    return (
      <div>
        <PageHeader title="Hoá đơn điện tử" />
        <Card>
          <EmptyState
            title="Chưa bật hoá đơn điện tử"
            hint="Chọn nhà cung cấp (hoặc Giả lập để thử) ở Cài đặt → Hoá đơn điện tử."
            action={
              <Link to="/admin/system/settings#einvoice">
                <Button variant="primary">Mở Cài đặt</Button>
              </Link>
            }
          />
        </Card>
      </div>
    );

  const rows = list.data?.rows.filter(
    (r) => filter === 'ALL' || r.status === filter || (filter === 'PENDING' && r.status === 'SENDING'),
  );
  const counts = list.data?.counts;
  return (
    <div>
      <PageHeader
        title="Hoá đơn điện tử"
        subtitle={
          c
            ? `${c.provider === 'MOCK' ? 'Giả lập' : 'SePay eInvoice'}${c.invoiceSeries ? ` · ký hiệu ${c.invoiceSeries}` : ''}${c.enabled ? '' : ' · đang tắt'}`
            : undefined
        }
        actions={
          <Button icon={<Send size={16} />} loading={send.isPending} onClick={() => send.mutate()}>
            Gửi ngay hoá đơn đang chờ
          </Button>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <RangePicker value={range} onChange={setPicked} />
        </div>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <Segmented
            label="Trạng thái"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'ALL', label: 'Tất cả' },
              { value: 'ISSUED', label: `Đã phát hành${counts ? ` (${counts.ISSUED ?? 0})` : ''}` },
              {
                value: 'PENDING',
                label: `Chờ gửi${counts ? ` (${(counts.PENDING ?? 0) + (counts.SENDING ?? 0)})` : ''}`,
              },
              { value: 'FAILED', label: `Bị từ chối${counts ? ` (${counts.FAILED ?? 0})` : ''}` },
            ]}
          />
        </div>
        <DataTable<EInvoiceDto>
          rows={rows}
          loading={list.isLoading}
          rowKey={(r) => r.id}
          empty={<EmptyState title="Không có hoá đơn nào" hint="Chọn khoảng ngày khác." />}
          columns={[
            {
              key: 'order',
              header: 'Đơn',
              cell: (r) => (
                <span className="flex flex-col">
                  <b className="num">{r.orderCode}</b>
                  <span className="text-xs text-faint">
                    {r.kind === 'ADJUSTMENT' ? 'Điều chỉnh giảm (đơn đã huỷ)' : (r.buyer?.name ?? 'Khách lẻ')}
                    {r.buyer?.taxCode ? ` · MST ${r.buyer.taxCode}` : ''}
                  </span>
                </span>
              ),
            },
            {
              key: 'no',
              header: 'Số hoá đơn',
              cell: (r) =>
                r.invoiceNo ? (
                  <span className="flex flex-col">
                    <span className="num">
                      {r.invoiceNo}
                      {r.series ? ` · ${r.series}` : ''}
                    </span>
                    {r.lookupUrl && (
                      <a
                        className="text-xs text-primary-ink underline"
                        href={r.lookupUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        xem hoá đơn
                      </a>
                    )}
                  </span>
                ) : (
                  '—'
                ),
            },
            {
              key: 'amount',
              header: 'Số tiền',
              align: 'right',
              cell: (r) => <span className="num">{money(r.amount)}</span>,
            },
            {
              key: 'status',
              header: 'Trạng thái',
              cell: (r) => (
                <span className="flex flex-col items-start gap-0.5">
                  <Badge tone={EINVOICE_STATUS[r.status].tone}>{EINVOICE_STATUS[r.status].label}</Badge>
                  {r.lastError && r.status !== 'ISSUED' && (
                    <span className="max-w-xs text-xs text-bad-ink">{r.lastError}</span>
                  )}
                </span>
              ),
            },
            { key: 'at', header: 'Lúc', secondary: true, cell: (r) => time(r.issuedAt ?? r.createdAt) },
          ]}
          actions={(r) =>
            r.status === 'FAILED' || r.status === 'PENDING' ? (
              <IconButton label="Gửi lại" size={34} onClick={() => retry.mutate(r)}>
                <RotateCw size={15} />
              </IconButton>
            ) : null
          }
        />
      </Card>
    </div>
  );
}
