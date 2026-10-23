import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { Ban, Banknote, Pencil, Plus } from 'lucide-react';
import type { LedgerEntry, SupplierDto } from '@ketoan/api/contracts';
import { useAuth } from '@/auth/AuthProvider';
import { FormError } from '@/auth/AuthCard';
import { PageHeader } from '@/components/PageHeader';
import { ReasonDialog } from '@/components/ReasonDialog';
import { DateInput } from '@/components/DateInput';
import { StatCard } from '@/components/report';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, Card, EmptyState, Segmented, Select, Switch } from '@/components/ui/controls';
import { DataTable } from '@/components/ui/DataTable';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input } from '@/components/ui/Input';
import { SearchInput } from '@/components/ui/SearchInput';
import { useToast } from '@/components/ui/Toast';
import { client, errorMessage, ok } from '@/lib/api-client';
import { useBusinessDateState, useBusinessToday } from '@/lib/business-date';
import { cn } from '@/lib/cn';
import { dateVi, money } from '@/lib/format';

const code = (id: number) => `PN${String(id).padStart(6, '0')}`;

/** What is owed to a supplier: "1.200.000", or an advance. */
function Balance({ value, strong }: { value: string; strong?: boolean }) {
  const n = Number(value);
  if (n === 0) return <span className="num text-faint">0</span>;
  if (n < 0) return <span className="num text-good">Trả trước {money(-n)}</span>;
  return <span className={cn('num text-warn', strong && 'font-bold')}>{money(n)}</span>;
}

/** Nhà cung cấp & công nợ: who the shop buys from and how much it still owes each of them. */
export function SuppliersPage() {
  const isAdmin = useAuth().user?.role === 'ADMIN';
  const [params, setParams] = useSearchParams();
  const openId = Number(params.get('id')) || null;
  const [filter, setFilter] = useState<'owing' | 'all'>('owing');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<SupplierDto | 'new' | null>(null);
  const list = useQuery({
    queryKey: ['suppliers', 'list'],
    queryFn: async () => ok(await client.suppliers.list()),
  });
  const all = list.data ?? [];
  const owing = all.filter((s) => Number(s.balance) > 0);
  const totalOwed = owing.reduce((t, s) => t + Number(s.balance), 0);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (list.data ?? []).filter(
      (s) =>
        (filter === 'all' || Number(s.balance) !== 0) &&
        (!q || s.name.toLowerCase().includes(q) || s.phone?.includes(q)),
    );
  }, [list.data, filter, search]);

  return (
    <div>
      <PageHeader
        title="Nhà cung cấp"
        subtitle="Công nợ = tiền các phiếu nhập − tiền đã trả. Trả tiền mặt sẽ tự ghi khoản chi vào sổ quỹ."
        actions={
          isAdmin && (
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditing('new')}>
              Thêm nhà cung cấp
            </Button>
          )
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard label="Đang nợ nhà cung cấp" value={money(totalOwed)} />
        <StatCard
          label="Số nhà cung cấp đang nợ"
          value={String(owing.length)}
          sub={`trên ${all.length} nhà cung cấp`}
        />
      </div>
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <Segmented
            label="Lọc"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'owing', label: 'Còn công nợ' },
              { value: 'all', label: 'Tất cả' },
            ]}
          />
          <SearchInput
            aria-label="Tìm nhà cung cấp"
            placeholder="Tìm tên, số điện thoại"
            className="h-9 w-64"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <DataTable<SupplierDto>
          rows={rows}
          loading={list.isLoading}
          rowKey={(s) => s.id}
          onRowClick={(s) => setParams({ id: String(s.id) })}
          empty={
            <EmptyState
              title={filter === 'owing' ? 'Không còn nợ nhà cung cấp nào' : 'Chưa có nhà cung cấp'}
              hint="Nhà cung cấp được thêm tự động khi tạo phiếu nhập có tên nhà cung cấp."
            />
          }
          columns={[
            {
              key: 'name',
              header: 'Nhà cung cấp',
              cell: (s) => (
                <span className="flex flex-col">
                  <span className="flex items-center gap-2 font-medium text-ink-strong">
                    {s.name}
                    {!s.active && <Badge>Ngừng giao dịch</Badge>}
                  </span>
                  {s.phone && <span className="text-xs text-muted">{s.phone}</span>}
                </span>
              ),
            },
            {
              key: 'last',
              header: 'Nhập gần nhất',
              secondary: true,
              cell: (s) => (s.lastReceiptDate ? dateVi(s.lastReceiptDate) : '—'),
            },
            {
              key: 'count',
              header: 'Số phiếu',
              align: 'right',
              secondary: true,
              cell: (s) => s.receiptCount,
            },
            {
              key: 'bought',
              header: 'Đã mua',
              align: 'right',
              secondary: true,
              cell: (s) => <span className="num">{money(s.purchased)}</span>,
            },
            {
              key: 'paid',
              header: 'Đã trả',
              align: 'right',
              cell: (s) => <span className="num">{money(s.paid)}</span>,
            },
            {
              key: 'owe',
              header: 'Còn nợ',
              align: 'right',
              cell: (s) => <Balance value={s.balance} strong />,
            },
          ]}
        />
      </Card>
      {openId !== null && (
        <LedgerDialog id={openId} onClose={() => setParams({})} onEdit={(s) => setEditing(s)} />
      )}
      {editing && (
        <SupplierForm supplier={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function LedgerDialog({
  id,
  onClose,
  onEdit,
}: {
  id: number;
  onClose: () => void;
  onEdit: (s: SupplierDto) => void;
}) {
  const isAdmin = useAuth().user?.role === 'ADMIN';
  const qc = useQueryClient();
  const toast = useToast();
  const [paying, setPaying] = useState(false);
  const [cancelling, setCancelling] = useState<LedgerEntry | null>(null);
  const q = useQuery({
    queryKey: ['suppliers', 'ledger', id],
    queryFn: async () => ok(await client.suppliers.ledger({ params: { id } })),
  });
  const s = q.data?.supplier;

  return (
    <Dialog
      open
      onClose={onClose}
      title={s?.name ?? 'Nhà cung cấp'}
      width={820}
      footer={
        <>
          {isAdmin && s && (
            <Button icon={<Pencil size={15} />} className="mr-auto" onClick={() => onEdit(s)}>
              Sửa thông tin
            </Button>
          )}
          <Button onClick={onClose}>Đóng</Button>
          <Button
            variant="primary"
            icon={<Banknote size={16} />}
            disabled={!s}
            onClick={() => setPaying(true)}
          >
            Trả tiền
          </Button>
        </>
      }
    >
      {!s ? (
        <p className="text-muted">Đang tải…</p>
      ) : (
        <div className="flex flex-col gap-4">
          {(s.phone || s.address || s.note) && (
            <p className="text-[13px] text-muted">
              {[s.phone, s.address, s.note].filter(Boolean).join(' · ')}
            </p>
          )}
          <div className="grid grid-cols-3 gap-2 text-[13px]">
            <div className="rounded-ctl bg-page px-3 py-2">
              <span className="text-muted">Đã mua</span>
              <b className="num block text-base text-ink-strong">{money(s.purchased)}</b>
            </div>
            <div className="rounded-ctl bg-page px-3 py-2">
              <span className="text-muted">Đã trả</span>
              <b className="num block text-base text-ink-strong">{money(s.paid)}</b>
            </div>
            <div className="rounded-ctl bg-warn-soft px-3 py-2">
              <span className="text-warn">Còn nợ</span>
              <b className="block text-base">
                <Balance value={s.balance} strong />
              </b>
            </div>
          </div>
          <div className="overflow-hidden rounded-card border border-line">
            <DataTable<LedgerEntry>
              rows={q.data?.entries}
              rowKey={(e) => `${e.kind}-${e.receiptId ?? 0}-${e.paymentId ?? 0}`}
              empty={<EmptyState title="Chưa có phiếu nhập hay lần trả nào" />}
              columns={[
                {
                  key: 'what',
                  header: 'Nội dung',
                  cell: (e) =>
                    e.kind === 'RECEIPT' ? (
                      <span className="flex flex-col">
                        <span className="font-medium text-primary-ink">Phiếu nhập {e.label}</span>
                        <span className="text-xs text-muted">
                          {Number(e.remaining) > 0 ? `còn nợ ${money(e.remaining)}` : 'đã trả đủ'}
                          {e.note ? ` · ${e.note}` : ''}
                        </span>
                      </span>
                    ) : (
                      <span className={cn('flex flex-col', e.cancelled && 'text-faint')}>
                        <span className={cn('font-medium', e.cancelled && 'line-through')}>{e.label}</span>
                        {(e.receiptId || e.note) && (
                          <span className="text-xs text-muted">
                            {[e.receiptId && `cho ${code(e.receiptId)}`, e.note].filter(Boolean).join(' · ')}
                          </span>
                        )}
                        {e.cancelled && (
                          <span className="text-xs text-bad-ink">Đã huỷ: {e.cancelReason}</span>
                        )}
                      </span>
                    ),
                },
                { key: 'date', header: 'Ngày', cell: (e) => dateVi(e.date) },
                {
                  key: 'amount',
                  header: 'Phát sinh',
                  align: 'right',
                  cell: (e) => (
                    <span
                      className={cn(
                        'num',
                        e.cancelled ? 'text-faint line-through' : Number(e.amount) < 0 && 'text-good',
                      )}
                    >
                      {Number(e.amount) > 0 ? '+' : ''}
                      {money(e.amount)}
                    </span>
                  ),
                },
                {
                  key: 'balance',
                  header: 'Còn nợ sau đó',
                  align: 'right',
                  cell: (e) => <span className="num font-semibold">{money(e.balance)}</span>,
                },
              ]}
              actions={(e) =>
                isAdmin && e.kind === 'PAYMENT' && !e.cancelled && e.method !== 'OPENING' ? (
                  <IconButton label="Huỷ lần trả này" size={34} onClick={() => setCancelling(e)}>
                    <Ban size={15} />
                  </IconButton>
                ) : null
              }
            />
          </div>
        </div>
      )}
      {paying && s && (
        <PayDialog supplier={s} entries={q.data?.entries ?? []} onClose={() => setPaying(false)} />
      )}
      <ReasonDialog
        open={cancelling !== null}
        danger
        title="Huỷ lần trả tiền"
        description={
          cancelling &&
          `${cancelling.label} ${money(-Number(cancelling.amount))} ngày ${dateVi(cancelling.date)}. Công nợ tăng lại; nếu trả tiền mặt, khoản chi trong sổ quỹ cũng bị huỷ.`
        }
        confirmLabel="Huỷ lần trả"
        onClose={() => setCancelling(null)}
        onConfirm={async (reason) => {
          ok(
            await client.suppliers.cancelPayment({
              params: { id: cancelling!.paymentId! },
              body: { reason },
            }),
          );
          toast('Đã huỷ lần trả tiền');
          qc.invalidateQueries({ queryKey: ['suppliers'] });
          qc.invalidateQueries({ queryKey: ['receipts'] });
          qc.invalidateQueries({ queryKey: ['cash'] });
        }}
      />
    </Dialog>
  );
}

function PayDialog({
  supplier,
  entries,
  onClose,
}: {
  supplier: SupplierDto;
  entries: LedgerEntry[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const today = useBusinessToday();
  const open = entries.filter((e) => e.kind === 'RECEIPT' && Number(e.remaining) > 0).reverse();
  const [date, setDate] = useBusinessDateState();
  const [amount, setAmount] = useState(Number(supplier.balance) > 0 ? String(Number(supplier.balance)) : '');
  const [method, setMethod] = useState<'CASH' | 'TRANSFER'>('CASH');
  const [receiptId, setReceiptId] = useState('');
  const [note, setNote] = useState('');
  const pay = useMutation({
    mutationFn: async () =>
      ok(
        await client.suppliers.pay({
          params: { id: supplier.id },
          body: {
            date,
            amount,
            method,
            receiptId: receiptId ? Number(receiptId) : null,
            note: note.trim() || null,
          },
        }),
      ),
    onSuccess: () => {
      toast(`Đã ghi trả ${money(amount)} cho ${supplier.name}`);
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      qc.invalidateQueries({ queryKey: ['receipts'] });
      qc.invalidateQueries({ queryKey: ['cash'] });
      onClose();
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Trả tiền — ${supplier.name}`}
      width={480}
      footer={
        <>
          <Button onClick={onClose}>Huỷ bỏ</Button>
          <Button
            variant="primary"
            loading={pay.isPending}
            disabled={!Number(amount)}
            onClick={() => pay.mutate()}
          >
            Ghi trả tiền
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
        <Field label="Số tiền" hint={`Đang nợ ${money(supplier.balance)}`}>
          {(id, describedBy) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              inputMode="numeric"
              className="num h-12 text-right text-lg font-bold"
              value={amount ? money(amount) : ''}
              placeholder="0"
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
            />
          )}
        </Field>
        {open.length > 0 && (
          <Field label="Trả cho phiếu nhập" hint="Không chọn: trừ vào các phiếu cũ nhất trước">
            {(id, describedBy) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={receiptId}
                onChange={(e) => setReceiptId(e.target.value)}
              >
                <option value="">Không chọn</option>
                {open.map((e) => (
                  <option key={e.receiptId} value={e.receiptId!}>
                    {e.label} · {dateVi(e.date)} · còn nợ {money(e.remaining)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label="Ghi chú">
          {(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        {method === 'CASH' && (
          <p className="text-xs text-muted">Tiền mặt lấy từ két: tự ghi một khoản chi vào sổ quỹ ngày đó.</p>
        )}
        <FormError message={pay.error ? errorMessage(pay.error) : null} />
      </div>
    </Dialog>
  );
}

function SupplierForm({ supplier, onClose }: { supplier: SupplierDto | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({
    name: supplier?.name ?? '',
    phone: supplier?.phone ?? '',
    address: supplier?.address ?? '',
    note: supplier?.note ?? '',
    active: supplier?.active ?? true,
  });
  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: f.name.trim(),
        phone: f.phone.trim() || null,
        address: f.address.trim() || null,
        note: f.note.trim() || null,
        active: f.active,
      };
      return ok(
        supplier
          ? await client.suppliers.update({ params: { id: supplier.id }, body })
          : await client.suppliers.create({ body }),
      );
    },
    onSuccess: () => {
      toast('Đã lưu nhà cung cấp');
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      qc.invalidateQueries({ queryKey: ['receipts'] });
      onClose();
    },
  });
  const text = (key: 'name' | 'phone' | 'address' | 'note', label: string) => (
    <Field label={label}>
      {(id) => <Input id={id} value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} />}
    </Field>
  );

  return (
    <Dialog
      open
      onClose={onClose}
      title={supplier ? 'Sửa nhà cung cấp' : 'Thêm nhà cung cấp'}
      width={480}
      footer={
        <>
          <Button onClick={onClose}>Huỷ bỏ</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!f.name.trim()}
            onClick={() => save.mutate()}
          >
            Lưu
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {text('name', 'Tên nhà cung cấp')}
        {text('phone', 'Điện thoại')}
        {text('address', 'Địa chỉ')}
        {text('note', 'Ghi chú')}
        {supplier && (
          <Switch
            checked={f.active}
            onChange={(active) => setF({ ...f, active })}
            label="Đang giao dịch"
            description="Tắt để không gợi ý khi tạo phiếu nhập. Công nợ cũ vẫn giữ."
          />
        )}
        <FormError message={save.error ? errorMessage(save.error) : null} />
      </div>
    </Dialog>
  );
}
