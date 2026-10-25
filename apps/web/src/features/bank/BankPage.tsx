import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EyeOff, Link2, RefreshCw, Undo2, Unlink } from 'lucide-react';
import type { BankTxnDto, TransferOrderDto } from '@ketoan/api/contracts';
import { PageHeader } from '@/components/PageHeader';
import { RangePicker, type Range } from '@/components/report';
import { ReasonDialog } from '@/components/ReasonDialog';
import { BankMatchDialog } from '@/components/BankMatchDialog';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, Card, EmptyState, Segmented } from '@/components/ui/controls';
import { DataTable } from '@/components/ui/DataTable';
import { useToast } from '@/components/ui/Toast';
import { client, errorMessage, ok } from '@/lib/api-client';
import { useBusinessToday } from '@/lib/business-date';
import { cn } from '@/lib/cn';
import { dateVi, money } from '@/lib/format';

type Filter = 'ALL' | 'UNMATCHED' | 'MATCHED' | 'IGNORED';
const KIND: Record<NonNullable<BankTxnDto['matchKind']>, string> = {
  CODE: 'theo mã đơn',
  AMOUNT: 'theo số tiền POS chờ',
  MANUAL: 'gán tay',
};
/** '24/10 01:53' in shop time. */
const time = (iso: string) => {
  const d = new Date(Date.parse(iso) + 7 * 3600_000).toISOString();
  return `${d.slice(8, 10)}/${d.slice(5, 7)} ${d.slice(11, 16)}`;
};

/** Kế toán › Tiền chuyển khoản: money read from the bank feed, and paid orders whose transfer never came. */
export function BankPage() {
  const today = useBusinessToday();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<'TXNS' | 'ORDERS'>('TXNS');
  const [picked, setPicked] = useState<Range | null>(null);
  const range = picked ?? { from: today, to: today };
  const [filter, setFilter] = useState<Filter>('ALL');
  const [matching, setMatching] = useState<BankTxnDto | null>(null);
  const [acting, setActing] = useState<{ t: BankTxnDto; kind: 'unmatch' | 'ignore' } | null>(null);

  const status = useQuery({
    queryKey: ['bank', 'status'],
    queryFn: async () => ok(await client.bank.status()),
  });
  const txns = useQuery({
    queryKey: ['bank', 'txns', range.from, range.to, filter],
    queryFn: async () => ok(await client.bank.list({ query: { ...range, filter } })),
    enabled: tab === 'TXNS' && !!status.data?.configured,
  });
  const orders = useQuery({
    queryKey: ['bank', 'unverified', range.from, range.to],
    queryFn: async () => ok(await client.bank.unverified({ query: range })),
    enabled: tab === 'ORDERS' && !!status.data?.configured,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['bank'] });
  const sync = useMutation({
    mutationFn: async () => ok(await client.bank.sync({ body: {} })),
    onSuccess: (r) => {
      refresh();
      toast(
        r.imported ? `Có ${r.imported} khoản tiền về, khớp được ${r.matched} đơn` : 'Không có tiền về mới',
      );
    },
    onError: (e) => {
      refresh();
      toast(errorMessage(e), 'bad');
    },
  });
  const unignore = useMutation({
    mutationFn: async (t: BankTxnDto) => ok(await client.bank.unignore({ params: { id: t.id }, body: {} })),
    onSuccess: () => {
      refresh();
      toast('Đã bỏ đánh dấu');
    },
    onError: (e) => toast(errorMessage(e), 'bad'),
  });

  const s = status.data;
  const d = txns.data;

  if (s && !s.configured)
    return (
      <div>
        <PageHeader title="Tiền chuyển khoản về" />
        <Card>
          <EmptyState
            title="Chưa nối dịch vụ báo số dư"
            hint="Nối SePay hoặc Casso để app tự đọc tiền vào tài khoản, tự khớp với đơn theo mã đơn trên VietQR và đối chiếu khi chốt ngày."
            action={
              <Link to="/admin/system/settings#bank-feed">
                <Button variant="primary">Mở Cài đặt</Button>
              </Link>
            }
          />
        </Card>
      </div>
    );

  return (
    <div>
      <PageHeader
        title="Tiền chuyển khoản về"
        subtitle={
          s
            ? `${s.provider === 'SEPAY' ? 'SePay' : 'Casso'}${s.accountNo ? ` · tài khoản ${s.accountNo}` : ''}${
                s.lastOkAt ? ` · đọc lần cuối ${time(s.lastOkAt)}` : ''
              }`
            : undefined
        }
        actions={
          <Button icon={<RefreshCw size={16} />} loading={sync.isPending} onClick={() => sync.mutate()}>
            Đọc ngay
          </Button>
        }
      />
      {s?.lastError && (
        <p className="mb-4 rounded-ctl bg-warn-soft px-3 py-2.5 text-[13px] text-warn">
          Lần đọc gần nhất bị lỗi: {s.lastError}
        </p>
      )}
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <Segmented
            label="Xem"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'TXNS', label: 'Tiền về' },
              { value: 'ORDERS', label: 'Đơn chưa khớp tiền' },
            ]}
          />
          <RangePicker value={range} onChange={setPicked} />
        </div>

        {tab === 'TXNS' && (
          <>
            <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
              <Segmented
                label="Lọc"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'ALL', label: 'Tất cả' },
                  { value: 'UNMATCHED', label: 'Chưa gán' },
                  { value: 'MATCHED', label: 'Đã gán đơn' },
                  { value: 'IGNORED', label: 'Bỏ qua' },
                ]}
              />
              {d && (
                <span className="ml-auto flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
                  <span>
                    Tiền về <b className="num text-ink-strong">{money(d.totals.received)}</b>
                  </span>
                  <span>
                    Đã gán <b className="num text-good">{money(d.totals.matched)}</b>
                  </span>
                  <span>
                    Chưa gán{' '}
                    <b className={cn('num', Number(d.totals.unmatched) > 0 ? 'text-warn' : 'text-ink')}>
                      {money(d.totals.unmatched)}
                    </b>
                  </span>
                </span>
              )}
            </div>
            <DataTable<BankTxnDto>
              rows={d?.rows}
              loading={txns.isLoading}
              rowKey={(t) => t.id}
              empty={
                <EmptyState
                  title="Không có khoản tiền về nào"
                  hint="Chọn khoảng ngày khác hoặc bấm Đọc ngay."
                />
              }
              columns={[
                {
                  key: 'what',
                  header: 'Nội dung',
                  cell: (t) => (
                    <span className="flex min-w-0 flex-col">
                      <span className="break-words text-ink-strong">{t.description || '—'}</span>
                      <span className="text-xs text-faint">
                        {[t.bankName, t.reference].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  ),
                },
                {
                  key: 'at',
                  header: 'Lúc',
                  cell: (t) => <span className="whitespace-nowrap">{time(t.transactedAt)}</span>,
                },
                {
                  key: 'amount',
                  header: 'Số tiền',
                  align: 'right',
                  cell: (t) => (
                    <b className={cn('num', t.ignored && 'text-faint line-through')}>{money(t.amount)}</b>
                  ),
                },
                {
                  key: 'status',
                  header: 'Khớp với',
                  cell: (t) =>
                    t.ignored ? (
                      <span className="flex flex-col items-start gap-0.5">
                        <Badge>Bỏ qua</Badge>
                        <span className="text-xs text-faint">{t.ignoreReason}</span>
                      </span>
                    ) : t.orderCode ? (
                      <span className="flex flex-col">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <b className="num">{t.orderCode}</b>
                          {t.orderStatus === 'CANCELLED' && <Badge tone="bad">Đơn đã huỷ</Badge>}
                          {t.orderStatus === 'OPEN' && <Badge tone="primary">Chưa thanh toán</Badge>}
                        </span>
                        <span className="text-xs text-faint">
                          {t.matchKind ? KIND[t.matchKind] : ''}
                          {t.matchedByName ? ` · ${t.matchedByName}` : ''}
                        </span>
                      </span>
                    ) : (
                      <Badge tone="warn">Chưa gán</Badge>
                    ),
                },
              ]}
              actions={(t) =>
                t.ignored ? (
                  <IconButton label="Bỏ đánh dấu bỏ qua" size={34} onClick={() => unignore.mutate(t)}>
                    <Undo2 size={15} />
                  </IconButton>
                ) : t.orderCode ? (
                  <IconButton label="Bỏ gán đơn" size={34} onClick={() => setActing({ t, kind: 'unmatch' })}>
                    <Unlink size={15} />
                  </IconButton>
                ) : (
                  <>
                    <IconButton label="Gán vào đơn" size={34} onClick={() => setMatching(t)}>
                      <Link2 size={15} />
                    </IconButton>
                    <IconButton
                      label="Bỏ qua (không phải tiền bán hàng)"
                      size={34}
                      onClick={() => setActing({ t, kind: 'ignore' })}
                    >
                      <EyeOff size={15} />
                    </IconButton>
                  </>
                )
              }
            />
          </>
        )}

        {tab === 'ORDERS' && (
          <DataTable<TransferOrderDto>
            rows={orders.data}
            loading={orders.isLoading}
            rowKey={(o) => o.orderId}
            empty={
              <EmptyState
                title="Tiền chuyển khoản về đủ"
                hint="Mọi đơn trả chuyển khoản trong khoảng này đều thấy tiền về đúng số."
              />
            }
            columns={[
              { key: 'code', header: 'Đơn', cell: (o) => <b className="num">{o.code}</b> },
              { key: 'day', header: 'Ngày', cell: (o) => dateVi(o.businessDate) },
              {
                key: 'exp',
                header: 'Ghi chuyển khoản',
                align: 'right',
                cell: (o) => <span className="num">{money(o.expected)}</span>,
              },
              {
                key: 'rec',
                header: 'Tiền về',
                align: 'right',
                cell: (o) => <span className="num">{money(o.received)}</span>,
              },
              {
                key: 'check',
                header: 'Tình trạng',
                cell: (o) =>
                  o.check === 'SHORT' ? (
                    <Badge tone="bad">Thiếu {money(Number(o.expected) - Number(o.received))}</Badge>
                  ) : o.status === 'CANCELLED' ? (
                    <Badge tone="warn">Đơn huỷ đã nhận tiền — hoàn tiền?</Badge>
                  ) : (
                    <Badge tone="warn">Thừa {money(Number(o.received) - Number(o.expected))}</Badge>
                  ),
              },
            ]}
          />
        )}
      </Card>

      {matching && (
        <BankMatchDialog
          txn={matching}
          onClose={() => setMatching(null)}
          onDone={(t) => {
            setMatching(null);
            refresh();
            toast(`Đã gán vào đơn ${t.orderCode}`);
          }}
        />
      )}
      <ReasonDialog
        open={acting !== null}
        title={acting?.kind === 'unmatch' ? 'Bỏ gán khoản tiền khỏi đơn' : 'Bỏ qua khoản tiền này'}
        description={
          acting &&
          (acting.kind === 'unmatch'
            ? `${money(acting.t.amount)} ₫ đang gán cho đơn ${acting.t.orderCode}.`
            : `${money(acting.t.amount)} ₫ — không phải tiền bán hàng (chủ quán tự chuyển, nhà cung cấp hoàn tiền…), không tính khi đối chiếu.`)
        }
        confirmLabel={acting?.kind === 'unmatch' ? 'Bỏ gán' : 'Bỏ qua'}
        onClose={() => setActing(null)}
        onConfirm={async (reason) => {
          const a = acting!;
          if (a.kind === 'unmatch')
            ok(await client.bank.unmatch({ params: { id: a.t.id }, body: { reason } }));
          else ok(await client.bank.ignore({ params: { id: a.t.id }, body: { reason } }));
          refresh();
          toast(a.kind === 'unmatch' ? 'Đã bỏ gán' : 'Đã bỏ qua khoản này');
        }}
      />
    </div>
  );
}
