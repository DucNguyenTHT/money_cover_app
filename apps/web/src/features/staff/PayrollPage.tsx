import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Ban, Banknote, Lock, LockOpen, Plus, Undo2 } from 'lucide-react';
import type { PayrollDto, PayrollLineDto, SalaryAdvanceDto } from '@ketoan/api/contracts';
import { FormError } from '@/auth/AuthCard';
import { PageHeader } from '@/components/PageHeader';
import { MonthPicker, thisMonth } from '@/components/MonthPicker';
import { ReasonDialog } from '@/components/ReasonDialog';
import { DateInput } from '@/components/DateInput';
import { StatCard } from '@/components/report';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, Card, EmptyState, Segmented, Select } from '@/components/ui/controls';
import { DataTable } from '@/components/ui/DataTable';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { client, errorMessage, ok } from '@/lib/api-client';
import { useBusinessDateState, useBusinessToday } from '@/lib/business-date';
import { cn } from '@/lib/cn';
import { dateVi, money } from '@/lib/format';

const METHOD: Record<string, string> = { CASH: 'tiền mặt', TRANSFER: 'chuyển khoản' };
type Adjust = Record<number, { bonus: string; deduction: string; note: string }>;

/** Bảng lương tháng: giờ công × lương giờ (hoặc lương tháng) + thưởng − trừ; còn trả = trừ tiếp tạm ứng. */
export function PayrollPage() {
  const [month, setMonth] = useState(thisMonth());
  const [y, m] = month.split('-').map(Number) as [number, number];
  const params = { year: y, month: m };
  const qc = useQueryClient();
  const toast = useToast();
  const [adjust, setAdjust] = useState<Adjust>({});
  const [asking, setAsking] = useState<'reopen' | null>(null);
  const [paying, setPaying] = useState<PayrollLineDto | null>(null);
  const [unpaying, setUnpaying] = useState<PayrollLineDto | null>(null);
  const [advance, setAdvance] = useState(false);
  const [cancelAdvance, setCancelAdvance] = useState<SalaryAdvanceDto | null>(null);
  const q = useQuery({
    queryKey: ['staff', 'payroll', month],
    queryFn: async () => ok(await client.staff.payroll({ params })),
  });
  const p = q.data;
  const draft = p?.status === 'DRAFT' && !p.locked;
  const dirty = Object.keys(adjust).length > 0;
  const refresh = (next?: PayrollDto) => {
    if (next) qc.setQueryData(['staff', 'payroll', month], next);
    qc.invalidateQueries({ queryKey: ['staff', 'payroll'] });
    qc.invalidateQueries({ queryKey: ['cash'] });
    qc.invalidateQueries({ queryKey: ['overheads'] });
  };
  const changeMonth = (v: string) => {
    setAdjust({});
    setMonth(v);
  };

  const value = (l: PayrollLineDto, k: 'bonus' | 'deduction' | 'note') =>
    adjust[l.employeeId]?.[k] ?? (k === 'note' ? (l.note ?? '') : String(Number(l[k])));
  const edit = (l: PayrollLineDto, k: 'bonus' | 'deduction' | 'note', v: string) =>
    setAdjust((a) => ({
      ...a,
      [l.employeeId]: {
        bonus: value(l, 'bonus'),
        deduction: value(l, 'deduction'),
        note: value(l, 'note'),
        ...a[l.employeeId],
        [k]: v,
      },
    }));
  /** Figures with the unsaved bonus / deduction applied. */
  const shown = (l: PayrollLineDto) => {
    const delta =
      Number(value(l, 'bonus')) - Number(l.bonus) - (Number(value(l, 'deduction')) - Number(l.deduction));
    return { gross: Number(l.gross) + delta, toPay: Number(l.toPay) + delta };
  };

  const save = useMutation({
    mutationFn: async () =>
      ok(
        await client.staff.savePayroll({
          params,
          body: {
            lines: Object.entries(adjust).map(([id, a]) => ({
              employeeId: Number(id),
              bonus: a.bonus || '0',
              deduction: a.deduction || '0',
              note: a.note.trim() || null,
            })),
          },
        }),
      ),
    onSuccess: (next) => {
      setAdjust({});
      refresh(next);
      toast('Đã lưu bảng lương');
    },
    onError: (e) => toast(errorMessage(e), 'bad'),
  });
  const close = useMutation({
    mutationFn: async () => {
      if (dirty) await save.mutateAsync();
      return ok(await client.staff.closePayroll({ params, body: {} }));
    },
    onSuccess: (next) => {
      refresh(next);
      toast(`Đã chốt bảng lương tháng ${m}/${y} — tổng lương đã ghi vào chi phí chung`);
    },
    onError: (e) => toast(errorMessage(e), 'bad'),
  });

  const totals = (p?.lines ?? []).reduce(
    (t, l) => {
      const s = shown(l);
      return { gross: t.gross + s.gross, advance: t.advance + Number(l.advance), toPay: t.toPay + s.toPay };
    },
    { gross: 0, advance: 0, toPay: 0 },
  );
  const paidCount = p?.lines.filter((l) => l.paidAt).length ?? 0;

  return (
    <div>
      <PageHeader
        title="Bảng lương"
        subtitle="Giờ công lấy từ chấm công. Chốt bảng lương thì tổng lương tự ghi vào chi phí chung của tháng."
        actions={
          p?.status === 'CLOSED' ? (
            !p.locked && (
              <Button icon={<LockOpen size={16} />} onClick={() => setAsking('reopen')}>
                Mở lại để sửa
              </Button>
            )
          ) : (
            <>
              <Button disabled={!draft} icon={<Plus size={16} />} onClick={() => setAdvance(true)}>
                Tạm ứng
              </Button>
              <Button
                disabled={!draft || !dirty}
                loading={save.isPending && !close.isPending}
                onClick={() => save.mutate()}
              >
                Lưu
              </Button>
              <Button
                variant="primary"
                icon={<Lock size={16} />}
                disabled={!draft || !p?.lines.length}
                loading={close.isPending}
                onClick={() => close.mutate()}
              >
                Chốt bảng lương
              </Button>
            </>
          )
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <MonthPicker value={month} onChange={changeMonth} />
        {p &&
          (p.status === 'CLOSED' ? (
            <Badge tone="good">
              Đã chốt {p.closedAt ? new Date(p.closedAt).toLocaleDateString('vi-VN') : ''}
              {p.closedByName ? ` · ${p.closedByName}` : ''}
            </Badge>
          ) : (
            <Badge tone="warn">Nháp — chưa chốt</Badge>
          ))}
        {p?.locked && <Badge>Tháng đã khoá sổ</Badge>}
      </div>
      {p && Number(p.otherSalaryOverhead) > 0 && (
        <p className="mb-3 flex items-start gap-2 rounded-ctl bg-warn-soft px-3 py-2 text-[13px] text-warn">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            Chi phí chung tháng này đã có khoản “Lương” nhập tay {money(p.otherSalaryOverhead)} ₫. Nếu đó cũng
            là lương nhân viên, hãy xoá ở{' '}
            <Link to="/admin/accounting/overheads" className="font-semibold underline">
              Chi phí chung
            </Link>{' '}
            để không tính hai lần.
          </span>
        </p>
      )}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Tổng lương tháng" value={money(totals.gross)} sub="ghi vào chi phí chung khi chốt" />
        <StatCard label="Đã tạm ứng" value={money(totals.advance)} />
        <StatCard label="Còn phải trả" value={money(totals.toPay)} />
        <StatCard label="Đã trả" value={`${paidCount}/${p?.lines.length ?? 0} người`} />
      </div>
      <Card>
        <DataTable<PayrollLineDto>
          rows={p?.lines}
          loading={q.isLoading}
          rowKey={(l) => l.employeeId}
          empty={
            <EmptyState
              title="Chưa có ai trong bảng lương"
              hint="Thêm nhân viên và chấm công; người lương tháng luôn có mặt."
            />
          }
          columns={[
            {
              key: 'name',
              header: 'Nhân viên',
              cell: (l) => (
                <span className="flex flex-col">
                  <span className="font-medium text-ink-strong">{l.name}</span>
                  <span className="text-xs text-muted">
                    {l.payType === 'HOURLY'
                      ? `${l.days} ngày · ${String(Number(l.hours)).replace('.', ',')} giờ × ${money(l.rate)}`
                      : `Lương tháng ${money(l.rate)}`}
                  </span>
                </span>
              ),
            },
            {
              key: 'base',
              header: 'Lương',
              align: 'right',
              cell: (l) => <span className="num">{money(l.basePay)}</span>,
            },
            {
              key: 'bonus',
              header: 'Thưởng',
              align: 'right',
              cell: (l) => (
                <MoneyCell
                  disabled={!draft}
                  label={`Thưởng ${l.name}`}
                  value={value(l, 'bonus')}
                  onChange={(v) => edit(l, 'bonus', v)}
                />
              ),
            },
            {
              key: 'deduction',
              header: 'Trừ',
              align: 'right',
              cell: (l) => (
                <MoneyCell
                  disabled={!draft}
                  label={`Trừ ${l.name}`}
                  value={value(l, 'deduction')}
                  onChange={(v) => edit(l, 'deduction', v)}
                />
              ),
            },
            {
              key: 'advance',
              header: 'Tạm ứng',
              align: 'right',
              cell: (l) => <span className="num">{Number(l.advance) ? `−${money(l.advance)}` : '—'}</span>,
            },
            {
              key: 'gross',
              header: 'Tổng lương',
              align: 'right',
              secondary: true,
              cell: (l) => <span className="num">{money(shown(l).gross)}</span>,
            },
            {
              key: 'toPay',
              header: 'Còn trả',
              align: 'right',
              cell: (l) => <b className="num">{money(shown(l).toPay)}</b>,
            },
            {
              key: 'note',
              header: 'Ghi chú',
              secondary: true,
              cell: (l) =>
                draft ? (
                  <Input
                    aria-label={`Ghi chú ${l.name}`}
                    className="h-8 min-w-[120px]"
                    value={value(l, 'note')}
                    onChange={(e) => edit(l, 'note', e.target.value)}
                  />
                ) : (
                  (l.note ?? '')
                ),
            },
          ]}
          actions={(l) =>
            p?.status !== 'CLOSED' ? null : l.paidAt ? (
              <span className="flex items-center gap-1">
                <Badge tone="good">Đã trả {METHOD[l.paidMethod ?? ''] ?? ''}</Badge>
                {!p.locked && (
                  <IconButton label={`Huỷ trả lương ${l.name}`} size={32} onClick={() => setUnpaying(l)}>
                    <Undo2 size={15} />
                  </IconButton>
                )}
              </span>
            ) : (
              <Button
                size="sm"
                variant="tonal"
                icon={<Banknote size={15} />}
                disabled={p.locked}
                onClick={() => setPaying(l)}
              >
                Trả
              </Button>
            )
          }
        />
        {p && p.lines.length > 0 && (
          <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 border-t border-line bg-total-row px-4 py-2.5 text-sm">
            <span>
              Tổng lương <b className="num">{money(totals.gross)}</b>
            </span>
            <span>
              Còn trả <b className="num">{money(totals.toPay)}</b>
            </span>
          </div>
        )}
      </Card>

      <Card className="mt-4">
        <h2 className="border-b border-line px-4 py-3 font-semibold">Tạm ứng trong tháng</h2>
        <DataTable<SalaryAdvanceDto>
          rows={p?.advances}
          rowKey={(a) => a.id}
          empty={<p className="py-6 text-center text-[13px] text-muted">Chưa có khoản tạm ứng nào.</p>}
          columns={[
            {
              key: 'who',
              header: 'Nhân viên',
              cell: (a) => (
                <span className={cn('flex flex-col', a.cancelled && 'text-faint')}>
                  <span className={cn('font-medium', a.cancelled && 'line-through')}>{a.employeeName}</span>
                  {a.cancelled && <span className="text-xs text-bad-ink">Đã huỷ: {a.cancelReason}</span>}
                  {a.note && <span className="text-xs text-muted">{a.note}</span>}
                </span>
              ),
            },
            { key: 'date', header: 'Ngày', cell: (a) => dateVi(a.date) },
            {
              key: 'method',
              header: 'Hình thức',
              cell: (a) => (a.method === 'CASH' ? 'Tiền mặt (két)' : 'Chuyển khoản'),
            },
            {
              key: 'amount',
              header: 'Số tiền',
              align: 'right',
              cell: (a) => (
                <span className={cn('num', a.cancelled && 'text-faint line-through')}>{money(a.amount)}</span>
              ),
            },
          ]}
          actions={(a) =>
            draft && !a.cancelled ? (
              <IconButton label="Huỷ khoản tạm ứng" size={32} onClick={() => setCancelAdvance(a)}>
                <Ban size={15} />
              </IconButton>
            ) : null
          }
        />
      </Card>

      {advance && p && (
        <AdvanceDialog lines={p.lines} month={month} onClose={() => setAdvance(false)} onDone={refresh} />
      )}
      {paying && <PayDialog line={paying} onClose={() => setPaying(null)} onDone={refresh} />}
      <ReasonDialog
        open={asking === 'reopen'}
        title={`Mở lại bảng lương tháng ${m}/${y}`}
        description="Khoản lương trong chi phí chung tháng này sẽ được gỡ ra cho tới khi chốt lại."
        confirmLabel="Mở lại"
        onClose={() => setAsking(null)}
        onConfirm={async (reason) => {
          refresh(ok(await client.staff.reopenPayroll({ params, body: { reason } })));
          toast('Đã mở lại bảng lương');
        }}
      />
      <ReasonDialog
        open={unpaying !== null}
        danger
        title={`Huỷ trả lương ${unpaying?.name ?? ''}`}
        description="Nếu đã trả bằng tiền mặt, khoản chi trong sổ quỹ cũng được huỷ."
        confirmLabel="Huỷ trả lương"
        onClose={() => setUnpaying(null)}
        onConfirm={async (reason) => {
          refresh(ok(await client.staff.unpayLine({ params: { id: unpaying!.lineId! }, body: { reason } })));
          toast('Đã huỷ trả lương');
        }}
      />
      <ReasonDialog
        open={cancelAdvance !== null}
        danger
        title="Huỷ khoản tạm ứng"
        description={
          cancelAdvance &&
          `${cancelAdvance.employeeName} ${money(cancelAdvance.amount)} ngày ${dateVi(cancelAdvance.date)}. Tạm ứng tiền mặt thì khoản chi trong sổ quỹ cũng được huỷ.`
        }
        confirmLabel="Huỷ tạm ứng"
        onClose={() => setCancelAdvance(null)}
        onConfirm={async (reason) => {
          ok(await client.staff.cancelAdvance({ params: { id: cancelAdvance!.id }, body: { reason } }));
          refresh();
          toast('Đã huỷ khoản tạm ứng');
        }}
      />
    </div>
  );
}

function MoneyCell({
  value,
  onChange,
  disabled,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  label: string;
}) {
  if (disabled) return <span className="num">{Number(value) ? money(value) : '—'}</span>;
  return (
    <Input
      aria-label={label}
      inputMode="numeric"
      className="num h-8 w-28 text-right"
      value={Number(value) ? money(value) : ''}
      placeholder="0"
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
    />
  );
}

function PayDialog({
  line,
  onClose,
  onDone,
}: {
  line: PayrollLineDto;
  onClose: () => void;
  onDone: (p: PayrollDto) => void;
}) {
  const toast = useToast();
  const today = useBusinessToday();
  const [method, setMethod] = useState<'CASH' | 'TRANSFER'>('CASH');
  const [date, setDate] = useBusinessDateState();
  const pay = useMutation({
    mutationFn: async () =>
      ok(await client.staff.payLine({ params: { id: line.lineId! }, body: { method, date } })),
    onSuccess: (p) => {
      onDone(p);
      toast(`Đã ghi trả lương ${line.name}`);
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Trả lương — ${line.name}`}
      width={440}
      footer={
        <>
          <Button onClick={onClose}>Huỷ bỏ</Button>
          <Button variant="primary" loading={pay.isPending} onClick={() => pay.mutate()}>
            Đã trả {money(line.toPay)} ₫
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented
            label="Hình thức"
            value={method}
            onChange={setMethod}
            options={[
              { value: 'CASH', label: 'Tiền mặt (từ két)' },
              { value: 'TRANSFER', label: 'Chuyển khoản / khác' },
            ]}
          />
          <DateInput aria-label="Ngày trả" value={date} max={today} onChange={setDate} className="w-40" />
        </div>
        <p className="text-[13px] text-muted">
          {method === 'CASH'
            ? 'Tự ghi một khoản chi “Trả lương” vào sổ quỹ ngày đó.'
            : 'Chỉ đánh dấu đã trả, không ảnh hưởng tiền mặt trong két.'}
        </p>
        <FormError message={pay.error ? errorMessage(pay.error) : null} />
      </div>
    </Dialog>
  );
}

function AdvanceDialog({
  lines,
  month,
  onClose,
  onDone,
}: {
  lines: PayrollLineDto[];
  month: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const today = useBusinessToday();
  const [employeeId, setEmployeeId] = useState('');
  const [date, setDate] = useBusinessDateState((t) => (t.startsWith(month) ? t : `${month}-01`));
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'CASH' | 'TRANSFER'>('CASH');
  const [note, setNote] = useState('');
  const save = useMutation({
    mutationFn: async () =>
      ok(
        await client.staff.createAdvance({
          body: { employeeId: Number(employeeId), date, amount, method, note: note.trim() || null },
        }),
      ),
    onSuccess: () => {
      onDone();
      toast('Đã ghi tạm ứng');
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Tạm ứng lương"
      width={460}
      footer={
        <>
          <Button onClick={onClose}>Huỷ bỏ</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!employeeId || !Number(amount)}
            onClick={() => save.mutate()}
          >
            Ghi tạm ứng
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Nhân viên">
          {(id) => (
            <Select id={id} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Chọn nhân viên</option>
              {lines.map((l) => (
                <option key={l.employeeId} value={l.employeeId}>
                  {l.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented
            label="Hình thức"
            value={method}
            onChange={setMethod}
            options={[
              { value: 'CASH', label: 'Tiền mặt (từ két)' },
              { value: 'TRANSFER', label: 'Chuyển khoản / khác' },
            ]}
          />
          <DateInput
            aria-label="Ngày tạm ứng"
            value={date}
            min={`${month}-01`}
            max={today}
            onChange={setDate}
            className="w-40"
          />
        </div>
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
        <Field label="Ghi chú">
          {(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        <p className="text-xs text-muted">
          Bảng lương tháng của ngày tạm ứng tự trừ khoản này. Tiền mặt từ két: tự ghi chi vào sổ quỹ.
        </p>
        <FormError message={save.error ? errorMessage(save.error) : null} />
      </div>
    </Dialog>
  );
}
