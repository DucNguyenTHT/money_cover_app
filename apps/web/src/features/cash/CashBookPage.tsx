import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, Ban } from 'lucide-react';
import type { CashEntryDto } from '@ketoan/api/contracts';
import { CASH_CATEGORIES, canCancelCash } from '@ketoan/api/domain';
import { useAuth } from '@/auth/AuthProvider';
import { FormError } from '@/auth/AuthCard';
import { PageHeader } from '@/components/PageHeader';
import { RangePicker, type Range } from '@/components/report';
import { ReasonDialog } from '@/components/ReasonDialog';
import { DateInput } from '@/components/DateInput';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, Card, EmptyState, Segmented } from '@/components/ui/controls';
import { DataTable } from '@/components/ui/DataTable';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { client, errorMessage, ok } from '@/lib/api-client';
import { useBusinessDateState, useBusinessToday } from '@/lib/business-date';
import { cn } from '@/lib/cn';
import { dateVi, money } from '@/lib/format';
import { posKeys } from '@/pos/data';

type Direction = CashEntryDto['direction'];
const SOURCE: Record<string, string> = {
  SUPPLIER_PAYMENT: 'Từ màn hình Nhà cung cấp',
  PAYROLL: 'Từ bảng lương',
  ADVANCE: 'Tạm ứng — từ bảng lương',
};
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

/** Sổ quỹ: cash put in / taken out of the till besides sales. Day closing counts it in the cash expected. */
export function CashBookPage({ inPos = false }: { inPos?: boolean }) {
  const today = useBusinessToday();
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [picked, setPicked] = useState<Range | null>(null);
  const range = picked ?? { from: today, to: today };
  const [adding, setAdding] = useState<Direction | null>(null);
  const [cancelling, setCancelling] = useState<CashEntryDto | null>(null);
  const list = useQuery({
    queryKey: ['cash', range.from, range.to],
    queryFn: async () => ok(await client.cash.list({ query: range })),
  });
  const d = list.data;

  const cancelBlock = (e: CashEntryDto) =>
    e.cancelled || !user
      ? 'Đã huỷ'
      : canCancelCash({
          role: user.role,
          isAuthor: e.createdById === user.id,
          sameDay: e.businessDate === today,
          automatic: e.source !== null,
        });

  return (
    <div className={inPos ? 'h-full overflow-y-auto p-3' : ''}>
      <PageHeader
        title="Sổ quỹ tiền mặt"
        subtitle="Tiền bỏ vào / lấy ra khỏi két ngoài bán hàng. Chốt ngày cộng trừ các khoản này vào tiền mặt dự kiến."
        actions={
          <>
            <Button icon={<ArrowDownLeft size={16} />} onClick={() => setAdding('IN')}>
              Thu tiền
            </Button>
            <Button variant="primary" icon={<ArrowUpRight size={16} />} onClick={() => setAdding('OUT')}>
              Chi tiền
            </Button>
          </>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <RangePicker value={range} onChange={setPicked} />
          <span className="ml-auto flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
            <span>
              Thu <b className="num text-good">{money(d?.totalIn)}</b>
            </span>
            <span>
              Chi <b className="num text-ink">{money(d?.totalOut)}</b>
            </span>
            <span>
              Chênh{' '}
              <b className="num text-ink-strong">{money(d ? Number(d.totalIn) - Number(d.totalOut) : 0)}</b>
            </span>
          </span>
        </div>
        <DataTable<CashEntryDto>
          rows={d?.entries}
          loading={list.isLoading}
          rowKey={(e) => e.id}
          empty={
            <EmptyState
              title="Chưa có khoản thu chi nào"
              hint="Ghi lại tiền lẻ đầu ngày, tiền đi chợ, tiền nộp ngân hàng… để cuối ngày két khớp."
            />
          }
          columns={[
            {
              key: 'what',
              header: 'Khoản mục',
              cell: (e) => (
                <span className={cn('flex flex-col', e.cancelled && 'text-faint')}>
                  <span className={cn('font-medium', e.cancelled ? 'line-through' : 'text-ink-strong')}>
                    {e.category}
                  </span>
                  {e.note && <span className="text-xs text-muted">{e.note}</span>}
                  {e.source && !e.cancelled && (
                    <span className="text-xs text-faint">{SOURCE[e.source] ?? 'Tự động'}</span>
                  )}
                  {e.cancelled && (
                    <span className="text-xs text-bad-ink">
                      Đã huỷ{e.cancelledByName ? ` bởi ${e.cancelledByName}` : ''}: {e.cancelReason}
                    </span>
                  )}
                </span>
              ),
            },
            {
              key: 'date',
              header: 'Ngày',
              cell: (e) => (
                <span className="whitespace-nowrap">
                  {dateVi(e.businessDate)} <span className="text-xs text-faint">{time(e.createdAt)}</span>
                </span>
              ),
            },
            {
              key: 'amount',
              header: 'Thu (+) / chi (−)',
              align: 'right',
              cell: (e) => (
                <b
                  className={cn(
                    'num',
                    e.cancelled ? 'text-faint line-through' : e.direction === 'IN' && 'text-good',
                  )}
                >
                  {e.direction === 'IN' ? '+' : '−'}
                  {money(e.amount)}
                </b>
              ),
            },
            { key: 'by', header: 'Người ghi', secondary: true, cell: (e) => e.createdByName },
          ]}
          actions={(e) =>
            cancelBlock(e) === null ? (
              <IconButton label="Huỷ khoản này" size={34} onClick={() => setCancelling(e)}>
                <Ban size={15} />
              </IconButton>
            ) : e.cancelled ? (
              <Badge>Đã huỷ</Badge>
            ) : null
          }
        />
      </Card>

      {adding && <EntryDialog direction={adding} today={today} onClose={() => setAdding(null)} />}
      <ReasonDialog
        open={cancelling !== null}
        danger
        title="Huỷ khoản thu chi"
        description={
          cancelling &&
          `${cancelling.category} ${money(cancelling.amount)} ngày ${dateVi(cancelling.businessDate)}. Khoản huỷ vẫn hiện trong sổ (gạch ngang).`
        }
        confirmLabel="Huỷ khoản"
        onClose={() => setCancelling(null)}
        onConfirm={async (reason) => {
          const e = cancelling!;
          ok(await client.cash.cancel({ params: { id: e.id }, body: { reason } }));
          toast('Đã huỷ khoản thu chi');
          qc.invalidateQueries({ queryKey: ['cash'] });
          qc.invalidateQueries({ queryKey: posKeys.day(e.businessDate) });
        }}
      />
    </div>
  );
}

function EntryDialog({
  direction,
  today,
  onClose,
}: {
  direction: Direction;
  today: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [dir, setDir] = useState(direction);
  const [date, setDate] = useBusinessDateState();
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const save = useMutation({
    mutationFn: async () =>
      ok(
        await client.cash.create({
          body: {
            businessDate: date,
            direction: dir,
            category: category.trim(),
            amount,
            note: note.trim() || null,
          },
        }),
      ),
    onSuccess: () => {
      toast(dir === 'IN' ? 'Đã ghi khoản thu' : 'Đã ghi khoản chi');
      qc.invalidateQueries({ queryKey: ['cash'] });
      qc.invalidateQueries({ queryKey: posKeys.day(date) });
      onClose();
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={dir === 'IN' ? 'Thu tiền vào két' : 'Chi tiền từ két'}
      width={480}
      footer={
        <>
          <Button onClick={onClose}>Huỷ bỏ</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!category.trim() || !Number(amount)}
            onClick={() => save.mutate()}
          >
            Lưu
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented
            label="Thu hay chi"
            value={dir}
            onChange={(v) => {
              setDir(v);
              setCategory('');
            }}
            options={[
              { value: 'IN', label: 'Thu vào két' },
              { value: 'OUT', label: 'Chi ra khỏi két' },
            ]}
          />
          <DateInput aria-label="Ngày" value={date} max={today} onChange={setDate} className="w-40" />
        </div>
        <Field label="Khoản mục">
          {(id) => (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-1.5">
                {CASH_CATEGORIES[dir].map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={category === c}
                    onClick={() => setCategory(c)}
                    className={cn(
                      'h-8 rounded-full border px-3 text-[13px]',
                      category === c
                        ? 'border-primary bg-primary-soft font-semibold text-primary-ink'
                        : 'border-field text-ink hover:bg-track',
                    )}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <Input
                id={id}
                value={category}
                placeholder="Hoặc gõ khoản khác"
                onChange={(e) => setCategory(e.target.value)}
              />
            </div>
          )}
        </Field>
        <Field label="Số tiền">
          {(id) => (
            <Input
              id={id}
              inputMode="numeric"
              className="num h-12 text-right text-lg font-bold"
              value={amount ? money(amount) : ''}
              placeholder="0"
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
            />
          )}
        </Field>
        <Field label="Ghi chú" hint={dir === 'OUT' ? 'Ví dụ: mua rau, đá; ai cầm tiền đi' : undefined}>
          {(id, describedBy) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          )}
        </Field>
        <p className="text-xs text-muted">
          Trả tiền nhà cung cấp làm ở màn hình Nhà cung cấp (hoặc khi tạo phiếu nhập) để trừ công nợ — khoản
          chi tự ghi vào đây.
        </p>
        <FormError message={save.error ? errorMessage(save.error) : null} />
      </div>
    </Dialog>
  );
}

export const PosCashBookPage = () => <CashBookPage inPos />;
