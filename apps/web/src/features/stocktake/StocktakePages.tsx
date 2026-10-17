import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ClipboardCheck, Plus, Save } from 'lucide-react';
import type { StocktakeDetail, StocktakeSummary } from '@ketoan/api/contracts';
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/PageHeader';
import { MonthPicker, thisMonth, today } from '@/components/MonthPicker';
import { ReasonDialog } from '@/components/ReasonDialog';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Badge, Card, EmptyState, Select, Switch } from '@/components/ui/controls';
import { DataTable } from '@/components/ui/DataTable';
import { useToast } from '@/components/ui/Toast';
import { SearchInput } from '@/components/ui/SearchInput';
import { FormError } from '@/auth/AuthCard';
import { client, errorMessage, ok } from '@/lib/api-client';
import { dateVi, money, parseQty, qty } from '@/lib/format';
import { cn } from '@/lib/cn';

const STATUS = {
  DRAFT: { label: 'Nháp', tone: 'warn' },
  DONE: { label: 'Đã chốt', tone: 'good' },
  CANCELLED: { label: 'Đã huỷ', tone: 'neutral' },
} as const;

const keys = {
  list: (m: string) => ['stocktakes', m] as const,
  one: (id: number) => ['stocktake', id] as const,
};

// ---------------------------------------------------------------- list

export function StocktakeListPage() {
  const [month, setMonth] = useState(thisMonth);
  const [creating, setCreating] = useState(false);
  const { user } = useAuth();
  const navigate = useNavigate();
  const list = useQuery({
    queryKey: keys.list(month),
    queryFn: async () => ok(await client.stocktake.list({ query: { month } })),
  });

  return (
    <div>
      <PageHeader
        title="Kiểm kê"
        subtitle="Đếm tồn thực tế, so với sổ sách; thiếu / thừa được trừ vào kho và phân bổ vào món đã dùng"
        actions={
          <>
            <MonthPicker value={month} onChange={setMonth} />
            <Button variant="primary" icon={<Plus size={18} />} onClick={() => setCreating(true)}>
              Tạo phiếu kiểm kê
            </Button>
          </>
        }
      />
      <Card>
        <DataTable<StocktakeSummary>
          rows={list.data}
          loading={list.isLoading}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/admin/inventory/stocktakes/${r.id}`)}
          empty={
            <EmptyState
              title="Chưa có phiếu kiểm kê trong tháng"
              hint="Nên kiểm kê ít nhất cuối mỗi tháng để lợi nhuận tháng đã trừ hao hụt."
            />
          }
          columns={[
            {
              key: 'date',
              header: 'Ngày kiểm',
              cell: (r) => <span className="font-medium">{dateVi(r.date)}</span>,
            },
            {
              key: 'status',
              header: 'Trạng thái',
              cell: (r) => <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>,
            },
            {
              key: 'count',
              header: 'Đã đếm',
              align: 'right',
              cell: (r) => (
                <span className="num">
                  {r.countedCount} / {r.itemCount}
                </span>
              ),
            },
            ...(user?.role === 'ADMIN'
              ? [
                  {
                    key: 'loss',
                    header: 'Hao hụt (thiếu − thừa)',
                    align: 'right' as const,
                    cell: (r: StocktakeSummary) => <LossText v={r.lossTotal ?? '0'} />,
                  },
                ]
              : []),
            { key: 'by', header: 'Người tạo', cell: (r) => r.createdByName, secondary: true },
            { key: 'note', header: 'Ghi chú', cell: (r) => r.note ?? '', secondary: true },
          ]}
        />
      </Card>
      <CreateDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function CreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Tạo phiếu kiểm kê"
      width={420}
      footer={
        <>
          <Button onClick={onClose}>Đóng</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const s = ok(await client.stocktake.create({ body: { date, note: note.trim() || null } }));
                navigate(`/admin/inventory/stocktakes/${s.id}`);
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Tạo phiếu
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5 text-[13px] font-medium">
          Ngày kiểm kê (tồn sổ sách tính đến cuối ngày này)
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] font-medium">
          Ghi chú
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Kiểm kê cuối tháng" />
        </label>
        <FormError message={error} />
      </div>
    </Dialog>
  );
}

const LossText = ({ v }: { v: string }) => {
  const n = Number(v);
  return (
    <span className={cn('num font-semibold', n > 0 ? 'text-bad' : n < 0 ? 'text-good' : 'text-muted')}>
      {money(n)}
      {n > 0 && <span className="ml-1 text-xs font-medium">thiếu</span>}
      {n < 0 && <span className="ml-1 text-xs font-medium">thừa</span>}
    </span>
  );
};

// ---------------------------------------------------------------- one stocktake

export function StocktakeEditPage() {
  const id = Number(useParams().id);
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: keys.one(id),
    queryFn: async () => ok(await client.stocktake.get({ params: { id } })),
  });
  const s = q.data;
  const draft = s?.status === 'DRAFT';

  const [counts, setCounts] = useState<Record<number, string>>({});
  const [note, setNote] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [busy, setBusy] = useState<'save' | 'complete' | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!s) return;
    setCounts(
      Object.fromEntries(s.items.map((i) => [i.ingredientId, i.actualQty === null ? '' : qty(i.actualQty)])),
    );
    setNote(s.note ?? '');
  }, [s]);

  const categories = useMemo(
    () => [...new Set((s?.items ?? []).map((i) => i.category ?? 'Khác'))].sort(),
    [s],
  );
  const rows = (s?.items ?? [])
    .map((i) => {
      const typed = counts[i.ingredientId] ?? '';
      const actual = typed === '' ? null : parseQty(typed);
      const diff = draft
        ? actual === null || Number.isNaN(actual)
          ? null
          : actual - Number(i.bookQty)
        : i.diffQty === null
          ? null
          : Number(i.diffQty);
      return { ...i, typed, diff };
    })
    .filter(
      (r) =>
        (!search ||
          r.name.toLowerCase().includes(search.toLowerCase()) ||
          r.code.toLowerCase().includes(search.toLowerCase())) &&
        (!category || (r.category ?? 'Khác') === category) &&
        (!onlyDiff || (r.diff !== null && Math.abs(r.diff) > 1e-9)),
    );
  const invalid = Object.values(counts).some(
    (v) => v !== '' && (Number.isNaN(parseQty(v)) || parseQty(v) < 0),
  );
  const counted = Object.values(counts).filter((v) => v !== '').length;

  const save = async () => {
    if (!s) return false;
    setBusy('save');
    try {
      const items = s.items.map((i) => {
        const v = counts[i.ingredientId] ?? '';
        return { ingredientId: i.ingredientId, actualQty: v === '' ? null : String(parseQty(v)) };
      });
      qc.setQueryData(
        keys.one(id),
        ok(await client.stocktake.update({ params: { id }, body: { note: note.trim() || null, items } })),
      );
      toast('Đã lưu nháp');
      return true;
    } catch (e) {
      toast(errorMessage(e), 'bad');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const complete = async () => {
    if (!(await save())) return;
    setBusy('complete');
    try {
      qc.setQueryData(keys.one(id), ok(await client.stocktake.complete({ params: { id }, body: {} })));
      qc.invalidateQueries({ queryKey: ['stocktakes'] });
      toast('Đã chốt kiểm kê');
      setConfirmOpen(false);
    } catch (e) {
      toast(errorMessage(e), 'bad');
    } finally {
      setBusy(null);
    }
  };

  if (!s) return <EmptyState title={q.isError ? 'Không tải được phiếu kiểm kê' : 'Đang tải…'} />;

  return (
    <div>
      <PageHeader
        title={`Kiểm kê ngày ${dateVi(s.date)}`}
        subtitle={
          s.periodFrom
            ? `Hao hụt phân bổ cho món bán từ sau ${dateVi(s.periodFrom)} đến ${dateVi(s.date)}`
            : 'Lần kiểm kê đầu tiên: phân bổ cho món bán từ trước tới nay'
        }
        actions={
          <>
            <Badge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Badge>
            <Button icon={<ArrowLeft size={18} />} onClick={() => navigate('/admin/inventory/stocktakes')}>
              Danh sách
            </Button>
          </>
        }
      />

      {s.status === 'DONE' && isAdmin && s.dishAllocations && s.dishAllocations.length > 0 && (
        <AllocationCard s={s} />
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-2.5 border-b border-line p-3">
          <SearchInput
            className="w-56"
            aria-label="Tìm nguyên liệu"
            placeholder="Tìm nguyên liệu"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="w-44">
            <Select aria-label="Nhóm" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Tất cả nhóm</option>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </div>
          <Switch checked={onlyDiff} onChange={setOnlyDiff} label="Chỉ dòng chênh lệch" />
          <span className="ml-auto text-[13px] text-muted">
            Đã đếm <b className="num text-ink">{counted}</b> / {s.items.length}
          </span>
        </div>

        <div className="hidden grid-cols-[minmax(0,1fr)_80px_120px_140px_140px] gap-3 bg-primary-soft px-4 py-2.5 text-[13px] font-semibold text-ink-strong sm:grid lg:grid-cols-[90px_minmax(0,1fr)_80px_120px_140px_140px_130px]">
          <span className="hidden lg:block">Mã</span>
          <span>Nguyên liệu</span>
          <span>ĐVT</span>
          <span className="text-right">Tồn sổ sách</span>
          <span className="text-right">Tồn thực tế</span>
          <span className="text-right">Chênh lệch</span>
          <span className="hidden text-right lg:block">
            {isAdmin && s.status === 'DONE' ? 'Giá trị' : ''}
          </span>
        </div>
        {rows.map((r) => (
          <div
            key={r.ingredientId}
            className={cn(
              'grid grid-cols-[minmax(0,1fr)_120px] items-center gap-x-3 gap-y-1 border-b border-[#f2f4f7] px-4 py-2 sm:grid-cols-[minmax(0,1fr)_80px_120px_140px_140px] lg:grid-cols-[90px_minmax(0,1fr)_80px_120px_140px_140px_130px]',
              Number(r.pendingQty) > 0 && 'bg-warn-soft/60',
            )}
          >
            <span className="hidden text-[13px] text-muted lg:block">{r.code}</span>
            <span className="min-w-0">
              <span className="font-medium">{r.name}</span>
              {Number(r.pendingQty) > 0 && (
                <span className="ml-2 align-middle">
                  <Badge tone="warn">Nợ kho {qty(r.pendingQty)}</Badge>
                </span>
              )}
              <span className="block text-xs text-muted sm:hidden">
                Sổ sách {qty(r.bookQty)} {r.unit}
              </span>
            </span>
            <span className="hidden text-muted sm:block">{r.unit}</span>
            <span className="num hidden text-right sm:block">{qty(r.bookQty)}</span>
            <span className="text-right">
              {draft ? (
                <Input
                  aria-label={`Tồn thực tế ${r.name}`}
                  inputMode="decimal"
                  value={r.typed}
                  placeholder="—"
                  invalid={r.typed !== '' && (Number.isNaN(parseQty(r.typed)) || parseQty(r.typed) < 0)}
                  onChange={(e) => setCounts((c) => ({ ...c, [r.ingredientId]: e.target.value }))}
                  className="num h-9 text-right"
                />
              ) : (
                <span className="num">{r.actualQty === null ? '—' : qty(r.actualQty)}</span>
              )}
            </span>
            <span className="num col-span-2 text-right text-[13px] sm:col-span-1 sm:text-sm">
              {r.diff === null ? (
                <span className="text-faint">chưa đếm</span>
              ) : Math.abs(r.diff) < 1e-9 ? (
                <span className="text-good">Khớp</span>
              ) : (
                <span className={r.diff < 0 ? 'font-semibold text-bad' : 'font-semibold text-warn'}>
                  {r.diff < 0 ? 'Thiếu ' : 'Thừa '}
                  {qty(Math.abs(r.diff))} {r.unit}
                </span>
              )}
            </span>
            <span className="hidden text-right lg:block">
              {isAdmin && s.status === 'DONE' && r.lossValue && Number(r.lossValue) !== 0 ? (
                <LossText v={r.lossValue} />
              ) : (
                ''
              )}
            </span>
          </div>
        ))}
        {rows.length === 0 && (
          <p className="py-10 text-center text-[13px] text-muted">Không có dòng phù hợp.</p>
        )}
      </Card>

      {s.status !== 'CANCELLED' && (
        <div className="sticky bottom-0 z-10 mt-3 rounded-card border border-line bg-white/95 px-4 py-2.5 shadow-[var(--shadow-pop)] backdrop-blur">
          <div className="flex flex-wrap items-center gap-2">
            {draft && (
              <Input
                aria-label="Ghi chú phiếu"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ghi chú phiếu"
                className="max-w-xs"
              />
            )}
            <div className="flex-1" />
            {isAdmin && (
              <Button variant="danger" onClick={() => setCancelOpen(true)}>
                Huỷ phiếu
              </Button>
            )}
            {draft && (
              <Button icon={<Save size={18} />} loading={busy === 'save'} disabled={invalid} onClick={save}>
                Lưu nháp
              </Button>
            )}
            {draft && isAdmin && (
              <Button
                variant="primary"
                icon={<ClipboardCheck size={18} />}
                disabled={invalid || counted === 0}
                onClick={() => setConfirmOpen(true)}
              >
                Chốt kiểm kê
              </Button>
            )}
          </div>
        </div>
      )}

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Chốt kiểm kê?"
        width={440}
        footer={
          <>
            <Button onClick={() => setConfirmOpen(false)}>Đóng</Button>
            <Button variant="primary" loading={busy !== null} onClick={complete}>
              Chốt
            </Button>
          </>
        }
      >
        <ul className="list-disc space-y-1 pl-5 text-[13px] text-muted">
          <li>Tồn sổ sách được tính lại tại thời điểm chốt (có thể đã bán thêm).</li>
          <li>Thiếu: trừ khỏi các lô cũ nhất. Thừa: tạo lô mới theo giá nhập gần nhất (bù nợ kho trước).</li>
          <li>Giá trị thiếu / thừa phân bổ vào các món đã dùng nguyên liệu đó.</li>
          <li>Nguyên liệu chưa đếm sẽ được bỏ qua.</li>
        </ul>
      </Dialog>
      <ReasonDialog
        open={cancelOpen}
        title="Huỷ phiếu kiểm kê"
        danger
        confirmLabel="Huỷ phiếu"
        description={
          s.status === 'DONE'
            ? 'Lô bị trừ sẽ được hoàn lại, lô thừa bị xoá (nếu chưa dùng) và phân bổ vào món bị xoá.'
            : undefined
        }
        onClose={() => setCancelOpen(false)}
        onConfirm={async (reason) => {
          qc.setQueryData(
            keys.one(id),
            ok(await client.stocktake.cancel({ params: { id }, body: { reason } })),
          );
          qc.invalidateQueries({ queryKey: ['stocktakes'] });
          toast('Đã huỷ phiếu kiểm kê');
        }}
      />
    </div>
  );
}

/** Loss per dish: diverging bars around 0 (shortage right in red, surplus left in green), values in their own column. */
function AllocationCard({ s }: { s: StocktakeDetail }) {
  const rows = s.dishAllocations ?? [];
  const max = Math.max(1, ...rows.map((r) => Math.abs(Number(r.lossValue))));
  const hasNeg = rows.some((r) => Number(r.lossValue) < 0);
  return (
    <Card className="mb-4">
      <h2 className="border-b border-line px-4 py-3 font-semibold">Phân bổ hao hụt vào món</h2>
      <div className="flex flex-col gap-1.5 p-4">
        {rows.map((r) => {
          const v = Number(r.lossValue);
          const w = `${(Math.abs(v) / max) * (hasNeg ? 50 : 100)}%`;
          return (
            <div
              key={String(r.dishId)}
              className="grid grid-cols-[140px_minmax(0,1fr)_110px] items-center gap-3 text-[13px] sm:grid-cols-[200px_minmax(0,1fr)_120px]"
            >
              <span className={cn('truncate', r.dishId === null && 'italic text-muted')}>{r.dishName}</span>
              <span className="relative h-[18px]">
                {hasNeg && <span className="absolute inset-y-[-3px] left-1/2 w-px bg-field" />}
                <span
                  title={`${r.dishName}: ${money(v)}`}
                  className={cn(
                    'absolute top-0 h-full',
                    v >= 0 ? 'rounded-r bg-[#e4867c]' : 'rounded-l bg-[#7cc4a0]',
                  )}
                  style={v >= 0 ? { left: hasNeg ? '50%' : 0, width: w } : { right: '50%', width: w }}
                />
              </span>
              <span className="text-right">
                <LossText v={r.lossValue} />
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
