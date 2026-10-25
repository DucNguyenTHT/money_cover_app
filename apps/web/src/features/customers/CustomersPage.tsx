import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Coins, Plus, UserRound } from 'lucide-react';
import type { CustomerDto } from '@ketoan/api/contracts';
import type { PointKind } from '@ketoan/api/domain';
import { useAuth } from '@/auth/AuthProvider';
import { FormError } from '@/auth/AuthCard';
import { PageHeader } from '@/components/PageHeader';
import { DateInput } from '@/components/DateInput';
import { ReasonDialog } from '@/components/ReasonDialog';
import { Button } from '@/components/ui/Button';
import { Badge, Card, EmptyState, Segmented } from '@/components/ui/controls';
import { DataTable } from '@/components/ui/DataTable';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input } from '@/components/ui/Input';
import { SearchInput } from '@/components/ui/SearchInput';
import { useToast } from '@/components/ui/Toast';
import { client, errorMessage, ok } from '@/lib/api-client';
import { dateVi, money } from '@/lib/format';

type Sort = 'RECENT' | 'SPENT' | 'POINTS' | 'NAME';
const KIND: Record<PointKind, string> = {
  EARN: 'Tích điểm',
  REDEEM: 'Đổi điểm',
  ADJUST: 'Chỉnh tay',
  REVERSE: 'Hoàn khi huỷ đơn',
};
const when = (iso: string) => {
  const d = new Date(Date.parse(iso) + 7 * 3600_000).toISOString();
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
};

/** Khách hàng: regular customers, their points and visits. */
export function CustomersPage() {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [sort, setSort] = useState<Sort>('RECENT');
  const [editing, setEditing] = useState<CustomerDto | 'new' | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const list = useQuery({
    queryKey: ['customers', term, sort],
    queryFn: async () =>
      ok(await client.customers.list({ query: { q: term || undefined, sort, limit: 300 } })),
  });
  const settings = useQuery({ queryKey: ['settings'], queryFn: async () => ok(await client.settings.get()) });
  const loyalty = settings.data?.settings.loyalty_enabled;

  return (
    <div>
      <PageHeader
        title="Khách quen"
        subtitle={
          loyalty
            ? `Tích ${money(settings.data!.settings.loyalty_earn_vnd)} ₫ = 1 điểm · 1 điểm = ${money(settings.data!.settings.loyalty_point_value)} ₫`
            : 'Tích điểm đang tắt (Hệ thống → Cài đặt → Khách quen & tích điểm)'
        }
        actions={
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditing('new')}>
            Thêm khách
          </Button>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <div className="w-72 max-w-full">
            <SearchInput
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Số điện thoại hoặc tên"
            />
          </div>
          <Segmented
            label="Sắp xếp"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'RECENT', label: 'Ghé gần đây' },
              { value: 'SPENT', label: 'Chi nhiều' },
              { value: 'POINTS', label: 'Nhiều điểm' },
              { value: 'NAME', label: 'Tên' },
            ]}
          />
        </div>
        <DataTable<CustomerDto>
          rows={list.data}
          loading={list.isLoading}
          rowKey={(c) => c.id}
          onRowClick={(c) => setViewing(c.id)}
          empty={
            <EmptyState
              title="Chưa có khách quen"
              hint="Thêm khách ở đây hoặc ngay trên màn bán hàng (nút Khách quen)."
            />
          }
          columns={[
            {
              key: 'name',
              header: 'Khách',
              cell: (c) => (
                <span className="flex flex-col">
                  <b className="text-ink-strong">
                    {c.name} {!c.active && <Badge>Ngừng</Badge>}
                  </b>
                  <span className="num text-xs text-muted">{c.phone}</span>
                </span>
              ),
            },
            {
              key: 'points',
              header: 'Điểm',
              align: 'right',
              cell: (c) => <b className="num text-primary-ink">{money(c.points)}</b>,
            },
            {
              key: 'visits',
              header: 'Lần ghé',
              align: 'right',
              cell: (c) => <span className="num">{c.visits}</span>,
            },
            {
              key: 'spent',
              header: 'Đã chi',
              align: 'right',
              cell: (c) => <span className="num">{money(c.totalSpent)}</span>,
            },
            {
              key: 'last',
              header: 'Ghé gần nhất',
              secondary: true,
              cell: (c) => (c.lastVisitAt ? when(c.lastVisitAt) : '—'),
            },
            {
              key: 'bd',
              header: 'Sinh nhật',
              secondary: true,
              cell: (c) => (c.birthday ? dateVi(c.birthday).slice(0, 5) : '—'),
            },
          ]}
        />
      </Card>
      {editing && (
        <CustomerForm customer={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
      {viewing !== null && (
        <CustomerView
          id={viewing}
          onEdit={(c) => {
            setViewing(null);
            setEditing(c);
          }}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}

function CustomerForm({ customer, onClose }: { customer: CustomerDto | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [phone, setPhone] = useState(customer?.phone ?? '');
  const [name, setName] = useState(customer?.name ?? '');
  const [birthday, setBirthday] = useState(customer?.birthday ?? '');
  const [note, setNote] = useState(customer?.note ?? '');
  const [active, setActive] = useState(customer?.active ?? true);
  const save = useMutation({
    mutationFn: async () => {
      const body = { phone, name, birthday: birthday || null, note: note.trim() || null };
      return customer
        ? ok(await client.customers.update({ params: { id: customer.id }, body: { ...body, active } }))
        : ok(await client.customers.create({ body }));
    },
    onSuccess: () => {
      toast('Đã lưu khách');
      qc.invalidateQueries({ queryKey: ['customers'] });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={customer ? `Sửa khách ${customer.name}` : 'Thêm khách quen'}
      width={480}
      footer={
        <>
          <Button onClick={onClose}>Huỷ bỏ</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!phone.trim() || !name.trim()}
            onClick={() => save.mutate()}
          >
            Lưu
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Số điện thoại">
          {(id) => (
            <Input
              id={id}
              inputMode="tel"
              className="num"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          )}
        </Field>
        <Field label="Tên">
          {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label="Sinh nhật">
          {() => <DateInput aria-label="Sinh nhật" value={birthday} onChange={setBirthday} />}
        </Field>
        <Field label="Ghi chú" hint="VD: hay ngồi bàn 5, ăn ít hành">
          {(id, d) => (
            <Input id={id} aria-describedby={d} value={note} onChange={(e) => setNote(e.target.value)} />
          )}
        </Field>
        {customer && (
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            Đang dùng (bỏ chọn = không tìm thấy ở màn bán hàng nữa)
          </label>
        )}
        <div className="sm:col-span-2">
          <FormError message={save.error ? errorMessage(save.error) : null} />
        </div>
      </div>
    </Dialog>
  );
}

function CustomerView({
  id,
  onEdit,
  onClose,
}: {
  id: number;
  onEdit: (c: CustomerDto) => void;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [adjusting, setAdjusting] = useState(false);
  const [delta, setDelta] = useState('');
  const q = useQuery({
    queryKey: ['customers', 'detail', id],
    queryFn: async () => ok(await client.customers.get({ params: { id } })),
  });
  const d = q.data;
  return (
    <Dialog
      open
      onClose={onClose}
      title={d ? d.customer.name : 'Khách'}
      width={640}
      footer={
        d && (
          <>
            {user?.role === 'ADMIN' && (
              <Button className="mr-auto" icon={<Coins size={16} />} onClick={() => setAdjusting(true)}>
                Cộng / trừ điểm
              </Button>
            )}
            <Button onClick={() => onEdit(d.customer)}>Sửa thông tin</Button>
            <Button variant="primary" onClick={onClose}>
              Đóng
            </Button>
          </>
        )
      }
    >
      {d && (
        <div className="flex flex-col gap-4 text-sm">
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted">
            <span className="flex items-center gap-1.5">
              <UserRound size={14} /> {d.customer.phone}
            </span>
            <span>
              <b className="num text-primary-ink">{money(d.customer.points)}</b> điểm
            </span>
            <span>{d.customer.visits} lần ghé</span>
            <span>đã chi {money(d.customer.totalSpent)} ₫</span>
            {d.customer.birthday && <span>sinh nhật {dateVi(d.customer.birthday).slice(0, 5)}</span>}
          </div>
          {d.customer.note && <p className="rounded-ctl bg-page px-3 py-2 text-[13px]">{d.customer.note}</p>}
          <div>
            <h3 className="mb-1.5 text-[13px] font-semibold">Lịch sử điểm</h3>
            <div className="max-h-56 divide-y divide-line-soft overflow-y-auto rounded-ctl border border-line-soft">
              {d.entries.length === 0 && <p className="px-3 py-2 text-[13px] text-muted">Chưa có.</p>}
              {d.entries.map((e) => (
                <div key={e.id} className="flex justify-between gap-3 px-3 py-1.5 text-[13px]">
                  <span>
                    {KIND[e.kind]}
                    {e.orderCode ? ` · đơn ${e.orderCode}` : ''}
                    {e.note && e.kind === 'ADJUST' ? ` · ${e.note}` : ''}
                    <span className="block text-xs text-faint">
                      {when(e.createdAt)}
                      {e.createdByName ? ` · ${e.createdByName}` : ''}
                    </span>
                  </span>
                  <b className={`num ${e.points < 0 ? 'text-bad' : 'text-good'}`}>
                    {e.points > 0 ? '+' : '−'}
                    {Math.abs(e.points)}
                  </b>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 className="mb-1.5 text-[13px] font-semibold">Đơn gần đây</h3>
            <div className="max-h-56 divide-y divide-line-soft overflow-y-auto rounded-ctl border border-line-soft">
              {d.orders.length === 0 && <p className="px-3 py-2 text-[13px] text-muted">Chưa có.</p>}
              {d.orders.map((o) => (
                <div key={o.id} className="flex justify-between gap-3 px-3 py-1.5 text-[13px]">
                  <span>
                    <b className="num">{o.code}</b> · {dateVi(o.businessDate)}
                    {o.status === 'CANCELLED' && <span className="ml-1 text-bad">(đã huỷ)</span>}
                  </span>
                  <span className="num">{money(o.total)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      <ReasonDialog
        open={adjusting}
        title="Cộng / trừ điểm"
        extra={
          <Field label="Số điểm (âm = trừ)">
            {(fid) => (
              <Input
                id={fid}
                inputMode="numeric"
                className="num text-right"
                value={delta}
                onChange={(e) => setDelta(e.target.value.replace(/[^\d-]/g, ''))}
              />
            )}
          </Field>
        }
        confirmLabel="Lưu"
        onClose={() => setAdjusting(false)}
        onConfirm={async (reason) => {
          ok(
            await client.customers.adjustPoints({ params: { id }, body: { points: Number(delta), reason } }),
          );
          toast('Đã chỉnh điểm');
          setDelta('');
          qc.invalidateQueries({ queryKey: ['customers'] });
        }}
      />
    </Dialog>
  );
}
