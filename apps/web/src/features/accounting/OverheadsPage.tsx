import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Lock, Plus, Trash2 } from 'lucide-react';
import { OVERHEAD_CATEGORIES, type OverheadMonth } from '@ketoan/api/contracts';
import { PageHeader } from '@/components/PageHeader';
import { thisMonth } from '@/components/MonthPicker';
import { Button, IconButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/controls';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { FormError } from '@/auth/AuthCard';
import { client, errorMessage, ok } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { money, parseMoney } from '@/lib/format';

export function OverheadsPage() {
  const [year, setYear] = useState(Number(thisMonth().slice(0, 4)));
  const [editing, setEditing] = useState<OverheadMonth | null>(null);
  const data = useQuery({
    queryKey: ['overheads', year],
    queryFn: async () => ok(await client.overheads.year({ query: { year } })),
  });
  const total = (data.data ?? []).reduce((s, m) => s + Number(m.total), 0);

  return (
    <div>
      <PageHeader
        title="Chi phí chung"
        subtitle="Mặt bằng, lương, điện nước… theo tháng. Trừ vào lợi nhuận ròng và dùng để tính tỷ lệ chi phí chung khi định giá."
      />
      <div className="mb-4 flex items-center gap-3">
        <div className="inline-flex h-9 items-center rounded-ctl border border-field bg-white">
          <button
            aria-label="Năm trước"
            className="inline-flex size-9 items-center justify-center text-muted"
            onClick={() => setYear(year - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <span className="w-16 text-center text-sm font-semibold">{year}</span>
          <button
            aria-label="Năm sau"
            className="inline-flex size-9 items-center justify-center text-muted"
            onClick={() => setYear(year + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <span className="text-[13px] text-muted">
          Cả năm <b className="text-ink num">{money(total)}</b>
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {data.data?.map((m) => (
          <button key={m.month} onClick={() => setEditing(m)} className="text-left">
            <Card
              className={cn(
                'flex h-full flex-col gap-1 p-4 hover:border-primary',
                m.lines.length === 0 && 'border-dashed',
              )}
            >
              <span className="flex items-center justify-between text-[13px] text-muted">
                Tháng {m.month}
                {m.locked && <Lock size={13} aria-label="Đã khoá sổ" />}
              </span>
              <span className="text-lg font-bold text-ink-strong num">
                {m.lines.length ? money(m.total) : '—'}
              </span>
              <span className="text-xs text-faint">
                {m.lines.length ? `${m.lines.length} khoản` : 'Chưa nhập'}
              </span>
            </Card>
          </button>
        ))}
      </div>
      {editing && <MonthEditor month={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function MonthEditor({ month, onClose }: { month: OverheadMonth; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [lines, setLines] = useState(() =>
    month.lines.length
      ? month.lines.map((l) => ({ ...l, amount: money(l.amount), note: l.note ?? '' }))
      : OVERHEAD_CATEGORIES.slice(0, 5).map((c) => ({ category: c, amount: '', note: '' })),
  );
  const total = lines.reduce((s, l) => s + (parseMoney(l.amount) || 0), 0);
  const save = useMutation({
    mutationFn: async () =>
      ok(
        await client.overheads.saveMonth({
          params: { year: month.year, month: month.month },
          body: {
            lines: lines
              .filter((l) => l.category.trim() && parseMoney(l.amount) > 0)
              .map((l) => ({
                category: l.category.trim(),
                amount: String(parseMoney(l.amount)),
                note: l.note.trim() || null,
              })),
          },
        }),
      ),
    onSuccess: () => {
      toast('Đã lưu chi phí chung');
      qc.invalidateQueries({ queryKey: ['overheads'] });
      qc.invalidateQueries({ queryKey: ['pricing'] });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Chi phí chung tháng ${month.month}/${month.year}`}
      width={620}
      footer={
        month.locked ? (
          <Button onClick={onClose}>Đóng</Button>
        ) : (
          <>
            <Button onClick={onClose}>Huỷ bỏ</Button>
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
              Lưu
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-2">
        {month.locked && (
          <p className="rounded-ctl bg-warn-soft px-3 py-2 text-[13px] text-warn">
            Tháng đã khoá sổ — chỉ xem.
          </p>
        )}
        <datalist id="overhead-cats">
          {OVERHEAD_CATEGORIES.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_140px_36px] gap-2">
            <Input
              aria-label="Khoản chi"
              list="overhead-cats"
              disabled={month.locked}
              value={l.category}
              onChange={(e) =>
                setLines(lines.map((x, j) => (j === i ? { ...x, category: e.target.value } : x)))
              }
            />
            <Input
              aria-label="Số tiền"
              inputMode="numeric"
              className="num text-right"
              disabled={month.locked}
              value={l.amount}
              onChange={(e) =>
                setLines(lines.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))
              }
            />
            {!month.locked && (
              <IconButton
                label="Xoá dòng"
                size={40}
                onClick={() => setLines(lines.filter((_, j) => j !== i))}
              >
                <Trash2 size={15} />
              </IconButton>
            )}
          </div>
        ))}
        {!month.locked && (
          <div>
            <Button
              size="sm"
              variant="tonal"
              icon={<Plus size={15} />}
              onClick={() => setLines([...lines, { category: '', amount: '', note: '' }])}
            >
              Thêm khoản
            </Button>
          </div>
        )}
        <div className="mt-2 flex justify-between rounded-ctl bg-total-row px-3 py-2 font-semibold">
          <span>Tổng</span>
          <span className="num">{money(total)}</span>
        </div>
        <FormError message={save.error ? errorMessage(save.error) : null} />
      </div>
    </Dialog>
  );
}
