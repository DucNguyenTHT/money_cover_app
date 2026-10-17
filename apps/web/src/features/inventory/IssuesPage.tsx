import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Plus, Trash2 } from 'lucide-react';
import type { IssueInput, IssueSummary } from '@ketoan/api/contracts';
import type { IssueReason } from '@ketoan/api/domain';
import { PageHeader } from '@/components/PageHeader';
import { MonthPicker, thisMonth } from '@/components/MonthPicker';
import { IngredientPicker, useIngredients } from '@/components/IngredientPicker';
import { ReasonDialog } from '@/components/ReasonDialog';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, Card, EmptyState, Select, type BadgeTone } from '@/components/ui/controls';
import { DataTable } from '@/components/ui/DataTable';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { FormError } from '@/auth/AuthCard';
import { client, errorMessage, ok } from '@/lib/api-client';
import { dateVi, money, parseQty, qty } from '@/lib/format';
import { useBusinessToday } from '@/lib/business-date';

export const REASON: Record<IssueReason, { label: string; tone: BadgeTone; hint?: string }> = {
  SALE_USE: { label: 'Tiêu hao bán hàng', tone: 'primary' },
  DISPOSAL: { label: 'Xuất huỷ', tone: 'bad', hint: 'Hàng hỏng, hết hạn — tính vào hao hụt' },
  SUPPLIER_RETURN: { label: 'Trả nhà cung cấp', tone: 'warn', hint: 'Chọn đúng lô đã nhập — giảm tiền nhập' },
  INTERNAL_USE: {
    label: 'Dùng nội bộ',
    tone: 'neutral',
    hint: 'Cơm nhân viên, biếu tặng — tính vào chi phí khác',
  },
};
type Manual = IssueInput['reason'];

export function IssuesPage() {
  const [params] = useSearchParams();
  const reason = (params.get('reason') as IssueReason | null) ?? undefined;
  const [month, setMonth] = useState(thisMonth());
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  const list = useQuery({
    queryKey: ['issues', month, reason],
    queryFn: async () => ok(await client.inventory.listIssues({ query: { month, reason } })),
  });

  return (
    <div>
      <PageHeader
        title={reason ? REASON[reason].label : 'Phiếu xuất'}
        subtitle="Phiếu tiêu hao bán hàng do hệ thống tự tạo khi thanh toán đơn"
        actions={
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>
            Tạo phiếu xuất
          </Button>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <MonthPicker value={month} onChange={setMonth} />
          <span className="ml-auto text-[13px] text-muted">{list.data?.length ?? 0} phiếu</span>
        </div>
        <DataTable<IssueSummary>
          rows={list.data}
          loading={list.isLoading}
          rowKey={(r) => r.id}
          onRowClick={(r) => setViewing(r.id)}
          empty={<EmptyState title="Chưa có phiếu xuất trong tháng" />}
          columns={[
            {
              key: 'reason',
              header: 'Loại',
              cell: (r) => (
                <span className="flex items-center gap-2">
                  <Badge tone={REASON[r.reason].tone}>{REASON[r.reason].label}</Badge>
                  {r.locked && <Lock size={13} className="text-faint" aria-label="Đã khoá sổ" />}
                </span>
              ),
            },
            { key: 'date', header: 'Ngày', cell: (r) => dateVi(r.date) },
            {
              key: 'note',
              header: 'Ghi chú',
              secondary: true,
              cell: (r) => (r.orderId ? `Đơn #${r.orderId}` : (r.note ?? '—')),
            },
            {
              key: 'pending',
              header: 'Nợ kho',
              align: 'right',
              secondary: true,
              cell: (r) => (Number(r.pendingQty) > 0 ? <Badge tone="warn">Có</Badge> : '—'),
            },
            {
              key: 'cost',
              header: 'Giá vốn',
              align: 'right',
              cell: (r) => <b className="num">{money(r.costTotal)}</b>,
            },
          ]}
        />
      </Card>
      {creating && (
        <IssueForm
          defaultReason={reason && reason !== 'SALE_USE' ? reason : 'DISPOSAL'}
          defaultMonth={month}
          onClose={() => setCreating(false)}
        />
      )}
      {viewing !== null && <IssueView id={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

interface Line {
  key: number;
  ingredientId: number | null;
  qty: string;
  lotId: number | null;
}
let k = 0;
const newLine = (): Line => ({ key: ++k, ingredientId: null, qty: '', lotId: null });

function IssueForm({
  defaultReason,
  defaultMonth,
  onClose,
}: {
  defaultReason: Manual;
  defaultMonth: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: ingredients } = useIngredients();
  const [reasonV, setReason] = useState<Manual>(defaultReason);
  const bizToday = useBusinessToday();
  const [date, setDate] = useState(defaultMonth === thisMonth() ? bizToday : `${defaultMonth}-01`);
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const setLine = (key: number, p: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));

  const save = useMutation({
    mutationFn: async () =>
      ok(
        await client.inventory.createIssue({
          body: {
            reason: reasonV,
            date,
            note: note.trim() || null,
            items: lines
              .filter((l) => l.ingredientId && parseQty(l.qty) > 0)
              .map((l) => ({
                ingredientId: l.ingredientId!,
                qty: String(parseQty(l.qty)),
                lotId: reasonV === 'SUPPLIER_RETURN' ? l.lotId : null,
              })),
          },
        }),
      ),
    onSuccess: (r) => {
      toast(`Đã xuất kho — giá vốn ${money(r.costTotal)}`);
      qc.invalidateQueries({ queryKey: ['issues'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
      onClose();
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title="Tạo phiếu xuất"
      width={760}
      footer={
        <>
          <Button onClick={onClose}>Huỷ bỏ</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Xuất kho
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Loại xuất" hint={REASON[reasonV].hint}>
            {(id, d) => (
              <Select
                id={id}
                aria-describedby={d}
                value={reasonV}
                onChange={(e) => setReason(e.target.value as Manual)}
              >
                <option value="DISPOSAL">{REASON.DISPOSAL.label}</option>
                <option value="SUPPLIER_RETURN">{REASON.SUPPLIER_RETURN.label}</option>
                <option value="INTERNAL_USE">{REASON.INTERNAL_USE.label}</option>
              </Select>
            )}
          </Field>
          <Field label="Ngày">
            {(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
          </Field>
        </div>
        <div className="flex flex-col gap-2">
          {lines.map((l) => {
            const ing = ingredients?.find((i) => i.id === l.ingredientId);
            return (
              <div
                key={l.key}
                className="grid items-end gap-2 rounded-card border border-line p-3 sm:grid-cols-[1fr_200px_120px_40px]"
              >
                <Field label="Nguyên liệu">
                  {() => (
                    <IngredientPicker
                      value={l.ingredientId}
                      onChange={(i) => setLine(l.key, { ingredientId: i.id, lotId: null })}
                    />
                  )}
                </Field>
                {reasonV === 'SUPPLIER_RETURN' ? (
                  <LotSelect
                    ingredientId={l.ingredientId}
                    value={l.lotId}
                    onChange={(lotId) => setLine(l.key, { lotId })}
                  />
                ) : (
                  <div className="hidden sm:block" />
                )}
                <Field label={`Số lượng${ing ? ` (${ing.unit})` : ''}`}>
                  {(id) => (
                    <Input
                      id={id}
                      inputMode="decimal"
                      className="num text-right"
                      value={l.qty}
                      onChange={(e) => setLine(l.key, { qty: e.target.value })}
                    />
                  )}
                </Field>
                {lines.length > 1 ? (
                  <IconButton label="Xoá dòng" onClick={() => setLines(lines.filter((x) => x.key !== l.key))}>
                    <Trash2 size={15} />
                  </IconButton>
                ) : (
                  <span />
                )}
              </div>
            );
          })}
          <div>
            <Button
              size="sm"
              variant="tonal"
              icon={<Plus size={15} />}
              onClick={() => setLines([...lines, newLine()])}
            >
              Thêm dòng
            </Button>
          </div>
        </div>
        <Field label="Ghi chú / lý do xuất">
          {(id) => (
            <Input
              id={id}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="VD: rau héo, hết hạn"
            />
          )}
        </Field>
        <FormError message={save.error ? errorMessage(save.error) : null} />
      </div>
    </Dialog>
  );
}

function LotSelect({
  ingredientId,
  value,
  onChange,
}: {
  ingredientId: number | null;
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  const lots = useQuery({
    queryKey: ['lots', ingredientId],
    enabled: ingredientId !== null,
    queryFn: async () =>
      ok(await client.inventory.lots({ query: { ingredientId: ingredientId!, open: 'true' } })),
  });
  return (
    <Field label="Lô hàng trả lại">
      {(id) => (
        <Select
          id={id}
          disabled={!ingredientId}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">— Chọn lô —</option>
          {lots.data?.map((l) => (
            <option key={l.id} value={l.id}>
              {dateVi(l.date)} · {l.source} · {money(l.unitPrice)} · còn {qty(l.qtyRemaining)}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

function IssueView({ id, onClose }: { id: number; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const issue = useQuery({
    queryKey: ['issue', id],
    queryFn: async () => ok(await client.inventory.getIssue({ params: { id } })),
  });
  const r = issue.data;
  const canDelete = r && !r.locked && r.reason !== 'SALE_USE' && !r.orderId;
  return (
    <Dialog
      open
      onClose={onClose}
      title={r ? `${REASON[r.reason].label} · ${dateVi(r.date)}` : 'Phiếu xuất'}
      width={720}
      footer={
        <>
          {canDelete && (
            <Button
              variant="danger"
              icon={<Trash2 size={16} />}
              className="mr-auto"
              onClick={() => setAsking(true)}
            >
              Xoá & hoàn kho
            </Button>
          )}
          <Button onClick={onClose}>Đóng</Button>
        </>
      }
    >
      {!r ? (
        <p className="text-muted">Đang tải…</p>
      ) : (
        <div className="flex flex-col gap-3">
          {r.note && <p className="text-[13px] text-muted">Ghi chú: {r.note}</p>}
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-primary-soft text-left text-[13px]">
                <th className="px-3 py-2 font-semibold">Nguyên liệu</th>
                <th className="px-3 py-2 text-right font-semibold">SL</th>
                <th className="px-3 py-2 font-semibold">Lấy từ lô</th>
                <th className="px-3 py-2 text-right font-semibold">Giá vốn</th>
              </tr>
            </thead>
            <tbody>
              {r.items.map((it) => (
                <tr key={it.ingredientId} className="border-b border-line align-top">
                  <td className="px-3 py-2">{it.ingredientName}</td>
                  <td className="px-3 py-2 text-right num">
                    {qty(it.qty)} {it.unit}
                  </td>
                  <td className="px-3 py-2 text-[13px] text-muted">
                    {it.allocations.map((a) => (
                      <div key={a.lotId}>
                        {qty(a.qty)} × {money(a.unitPrice)} (lô {dateVi(a.lotDate)})
                      </div>
                    ))}
                    {Number(it.pendingQty) > 0 && (
                      <Badge tone="warn">
                        Nợ kho {qty(it.pendingQty)} {it.unit}
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold num">{money(it.costTotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-total-row font-bold">
                <td className="px-3 py-2" colSpan={3}>
                  Tổng giá vốn
                </td>
                <td className="px-3 py-2 text-right num">{money(r.costTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <ReasonDialog
        open={asking}
        danger
        title="Xoá phiếu xuất"
        description="Số lượng sẽ được trả lại đúng các lô đã lấy."
        confirmLabel="Xoá & hoàn kho"
        onClose={() => setAsking(false)}
        onConfirm={async (reason) => {
          ok(await client.inventory.deleteIssue({ params: { id }, body: { reason } }));
          toast('Đã xoá phiếu xuất và hoàn kho');
          qc.invalidateQueries({ queryKey: ['issues'] });
          qc.invalidateQueries({ queryKey: ['stock'] });
          onClose();
        }}
      />
    </Dialog>
  );
}
