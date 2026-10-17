import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { AlertTriangle, Lock, Paperclip, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import type { ReceiptDetail, ReceiptInput, ReceiptSummary } from '@ketoan/api/contracts';
import { PageHeader } from '@/components/PageHeader';
import { MonthPicker, thisMonth, today } from '@/components/MonthPicker';
import { IngredientPicker, useIngredients } from '@/components/IngredientPicker';
import { ReasonDialog } from '@/components/ReasonDialog';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, Card, EmptyState, Segmented, Select } from '@/components/ui/controls';
import { DataTable } from '@/components/ui/DataTable';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { FormError } from '@/auth/AuthCard';
import { client, errorMessage, ok } from '@/lib/api-client';
import { dateVi, money, parseMoney, parseQty, qty } from '@/lib/format';
import { attachToReceipt } from '@/lib/documents';
import {
  AddFilesButtons,
  FileGrid,
  ReceiptDocuments,
  uploadSummary,
} from '@/features/documents/DocumentFiles';

/**
 * New purchase prices can push dishes over their food-cost target: remind the ADMIN right here.
 * Refreshed after every saved receipt (the ['pricing'] query is invalidated).
 */
function PriceAlertBanner() {
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ['pricing', 'alerts'],
    queryFn: async () => ok(await client.pricing.alerts()),
    enabled: user?.role === 'ADMIN',
  });
  const rows = q.data ?? [];
  if (!rows.length) return null;
  const loss = rows.filter((r) => r.alert === 'LOSS').length;
  return (
    <Link
      to="/admin/menu/price-alerts"
      className="mb-3 flex items-center gap-2 rounded-ctl bg-warn-soft px-3 py-2 text-[13px] text-warn hover:underline"
    >
      <AlertTriangle size={16} className="shrink-0" />
      Theo giá nhập mới nhất: {loss > 0 && `${loss} món đang lỗ, `}
      {rows.length - loss > 0 && `${rows.length - loss} món vượt % nguyên liệu mục tiêu`} — xem giá gợi ý
    </Link>
  );
}

export function ReceiptsPage() {
  const [month, setMonth] = useState(thisMonth());
  const [open, setOpen] = useState<number | 'new' | null>(null);
  const list = useQuery({
    queryKey: ['receipts', month],
    queryFn: async () => ok(await client.inventory.listReceipts({ query: { month } })),
  });
  const total = (list.data ?? [])
    .filter((r) => r.kind === 'PURCHASE')
    .reduce((s, r) => s + Number(r.total), 0);

  return (
    <div>
      <PageHeader
        title="Phiếu nhập"
        subtitle="Mỗi dòng phiếu nhập tạo một lô hàng giữ đúng giá nhập của lần đó"
        actions={
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setOpen('new')}>
            Tạo phiếu nhập
          </Button>
        }
      />
      <PriceAlertBanner />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <MonthPicker value={month} onChange={setMonth} />
          <span className="ml-auto text-[13px] text-muted">
            {list.data?.length ?? 0} phiếu · tiền nhập <b className="text-ink num">{money(total)}</b>
          </span>
        </div>
        <DataTable<ReceiptSummary>
          rows={list.data}
          loading={list.isLoading}
          rowKey={(r) => r.id}
          onRowClick={(r) => setOpen(r.id)}
          empty={
            <EmptyState
              title="Chưa có phiếu nhập trong tháng"
              action={
                <Button variant="tonal" icon={<Plus size={16} />} onClick={() => setOpen('new')}>
                  Tạo phiếu nhập
                </Button>
              }
            />
          }
          columns={[
            {
              key: 'supplier',
              header: 'Nhà cung cấp',
              cell: (r) => (
                <span className="flex items-center gap-2">
                  {r.kind === 'OPENING' ? <Badge tone="primary">Tồn đầu</Badge> : (r.supplier ?? '—')}
                  {r.locked && <Lock size={13} className="text-faint" aria-label="Đã khoá sổ" />}
                </span>
              ),
            },
            { key: 'date', header: 'Ngày', cell: (r) => dateVi(r.date) },
            {
              key: 'code',
              header: 'Mã phiếu',
              secondary: true,
              cell: (r) => <span className="text-primary-ink">PN{String(r.id).padStart(6, '0')}</span>,
            },
            { key: 'items', header: 'Số dòng', align: 'right', secondary: true, cell: (r) => r.itemCount },
            {
              key: 'docs',
              header: 'Hoá đơn',
              align: 'center',
              cell: (r) =>
                r.documentCount > 0 ? (
                  <Paperclip size={15} className="inline text-primary-ink" aria-label="Đã có ảnh hoá đơn" />
                ) : r.kind === 'PURCHASE' ? (
                  <span className="text-xs text-faint">Chưa có</span>
                ) : (
                  '—'
                ),
            },
            { key: 'by', header: 'Người tạo', secondary: true, cell: (r) => r.createdBy },
            {
              key: 'total',
              header: 'Tổng tiền',
              align: 'right',
              cell: (r) => <b className="num">{money(r.total)}</b>,
            },
          ]}
        />
      </Card>
      {open !== null && (
        <ReceiptEditor id={open === 'new' ? null : open} defaultMonth={month} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

interface Line {
  key: number;
  ingredientId: number | null;
  qty: string;
  unitPrice: string;
  unitMode: 'STOCK' | 'PURCHASE';
}
let lineKey = 0;
const emptyLine = (): Line => ({
  key: ++lineKey,
  ingredientId: null,
  qty: '',
  unitPrice: '',
  unitMode: 'STOCK',
});
const q = (v: string) => parseQty(v) || 0;
const m = (v: string) => parseMoney(v) || 0;

function ReceiptEditor({
  id,
  defaultMonth,
  onClose,
}: {
  id: number | null;
  defaultMonth: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: ingredients } = useIngredients();
  const suppliers = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => ok(await client.inventory.suppliers()),
  });
  const existing = useQuery({
    queryKey: ['receipt', id],
    enabled: id !== null,
    queryFn: async () => ok(await client.inventory.getReceipt({ params: { id: id! } })),
  });

  const [form, setForm] = useState<{
    kind: ReceiptInput['kind'];
    date: string;
    supplier: string;
    note: string;
    lines: Line[];
  } | null>(
    id === null
      ? {
          kind: 'PURCHASE',
          date: defaultMonth === thisMonth() ? today() : `${defaultMonth}-01`,
          supplier: '',
          note: '',
          lines: [emptyLine()],
        }
      : null,
  );
  const [askReason, setAskReason] = useState<'update' | 'delete' | null>(null);
  /** Invoice photos picked while creating a new receipt; uploaded right after it is saved. */
  const [photos, setPhotos] = useState<File[]>([]);
  const [progress, setProgress] = useState<string | null>(null);

  const r = existing.data;
  if (id !== null && r && !form) {
    setForm({
      kind: r.kind,
      date: r.date,
      supplier: r.supplier ?? '',
      note: r.note ?? '',
      lines: r.items.map((i) => ({
        key: ++lineKey,
        ingredientId: i.ingredientId,
        qty: i.purchaseUnitQty ?? i.qty,
        unitPrice: i.purchaseUnitQty
          ? String(Math.round(Number(i.amount) / Number(i.purchaseUnitQty)))
          : String(Math.round(Number(i.unitPrice))),
        unitMode: i.purchaseUnitQty ? 'PURCHASE' : 'STOCK',
      })),
    });
  }

  const readOnly = !!r && (r.consumed || r.locked);
  const total = useMemo(
    () => (form?.lines ?? []).reduce((s, l) => s + Math.round(q(l.qty) * m(l.unitPrice)), 0),
    [form],
  );

  const body = (): ReceiptInput => ({
    kind: form!.kind,
    date: form!.date,
    supplier: form!.supplier.trim() || null,
    note: form!.note.trim() || null,
    items: form!.lines
      .filter((l) => l.ingredientId && q(l.qty) > 0)
      .map((l) => ({
        ingredientId: l.ingredientId!,
        qty: String(q(l.qty)),
        unitPrice: String(m(l.unitPrice)),
        unitMode: l.unitMode,
      })),
  });

  const done = (msg: string) => {
    toast(msg);
    qc.invalidateQueries({ queryKey: ['receipts'] });
    qc.invalidateQueries({ queryKey: ['stock'] });
    qc.invalidateQueries({ queryKey: ['suppliers'] });
    qc.invalidateQueries({ queryKey: ['pricing'] });
    onClose();
  };

  const create = useMutation({
    mutationFn: async () => {
      const receipt = ok(await client.inventory.createReceipt({ body: body() }));
      if (!photos.length) return null;
      try {
        return await attachToReceipt(receipt, photos, (d, t) => setProgress(`Đang tải ảnh ${d + 1}/${t}…`));
      } catch (e) {
        return { uploaded: 0, failed: [{ name: 'Ảnh hoá đơn', message: errorMessage(e) }] };
      }
    },
    onSettled: () => setProgress(null),
    onSuccess: (upload) => {
      qc.invalidateQueries({ queryKey: ['documents'] });
      if (upload?.failed.length) {
        toast(`Đã lưu phiếu nhập. ${uploadSummary(upload)} — mở lại phiếu để đính kèm`, 'bad');
        done('Đã lưu phiếu nhập');
      } else done(upload ? `Đã lưu phiếu nhập và ${upload.uploaded} ảnh hoá đơn` : 'Đã lưu phiếu nhập');
    },
  });

  const setLine = (key: number, patch: Partial<Line>) =>
    setForm((f) => f && { ...f, lines: f.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) });

  const title = id === null ? 'Tạo phiếu nhập' : `Phiếu nhập PN${String(id).padStart(6, '0')}`;

  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      width={920}
      footer={
        readOnly ? (
          <Button onClick={onClose}>Đóng</Button>
        ) : (
          <>
            {id !== null && (
              <Button
                variant="danger"
                icon={<Trash2 size={16} />}
                className="mr-auto"
                onClick={() => setAskReason('delete')}
              >
                Xoá phiếu
              </Button>
            )}
            <Button onClick={onClose}>Huỷ bỏ</Button>
            <Button
              variant="primary"
              loading={create.isPending}
              onClick={() => (id === null ? create.mutate() : setAskReason('update'))}
              disabled={!form || body().items.length === 0}
            >
              Lưu phiếu
            </Button>
          </>
        )
      }
    >
      {!form ? (
        <p className="text-muted">Đang tải…</p>
      ) : (
        <div className="flex flex-col gap-4">
          {readOnly && (
            <p className="rounded-ctl bg-warn-soft px-3 py-2 text-[13px] text-warn">
              {r?.locked
                ? 'Tháng này đã khoá sổ — chỉ xem.'
                : 'Hàng của phiếu này đã được xuất / bán một phần — chỉ xem. Muốn sửa, hãy xoá các phiếu xuất liên quan trước.'}
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium">Loại phiếu</span>
              <Segmented
                label="Loại phiếu"
                value={form.kind}
                onChange={(k) => !readOnly && setForm({ ...form, kind: k })}
                options={[
                  { value: 'PURCHASE', label: 'Nhập hàng' },
                  { value: 'OPENING', label: 'Tồn đầu' },
                ]}
              />
            </div>
            <Field label="Ngày">
              {(fid) => (
                <Input
                  id={fid}
                  type="date"
                  disabled={readOnly}
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                />
              )}
            </Field>
            {form.kind === 'PURCHASE' && (
              <Field label="Nhà cung cấp">
                {(fid) => (
                  <>
                    <Input
                      id={fid}
                      list="supplier-list"
                      disabled={readOnly}
                      value={form.supplier}
                      onChange={(e) => setForm({ ...form, supplier: e.target.value })}
                    />
                    <datalist id="supplier-list">
                      {suppliers.data?.map((x) => (
                        <option key={x} value={x} />
                      ))}
                    </datalist>
                  </>
                )}
              </Field>
            )}
          </div>
          {form.kind === 'OPENING' && (
            <p className="text-[13px] text-muted">
              Phiếu tồn đầu: nhập số lượng đang có trong kho và giá vốn hiện tại khi bắt đầu dùng app. Không
              tính vào tiền nhập của kỳ.
            </p>
          )}

          {/* Lines: a grid row per line on tablet/desktop, a stacked card per line on phones */}
          <div className="overflow-hidden rounded-card border border-line">
            <div className="hidden grid-cols-[minmax(0,1fr)_150px_110px_140px_130px_44px] gap-2 bg-primary-soft px-3 py-2 text-[13px] font-semibold text-ink-strong md:grid">
              <span>Nguyên liệu</span>
              <span>Đơn vị</span>
              <span className="text-right">Số lượng</span>
              <span className="text-right">Đơn giá</span>
              <span className="text-right">Thành tiền</span>
              <span />
            </div>
            {form.lines.map((l, idx) => {
              const ing = ingredients?.find((i) => i.id === l.ingredientId);
              return (
                <div
                  key={l.key}
                  className="grid grid-cols-2 items-center gap-2 border-t border-line px-3 py-2.5 first:border-t-0 md:grid-cols-[minmax(0,1fr)_150px_110px_140px_130px_44px] md:py-1.5 md:[&:nth-child(2)]:border-t-0"
                >
                  <div className="col-span-2 md:col-span-1">
                    <span className="mb-1 block text-xs text-faint md:hidden">Dòng {idx + 1}</span>
                    {readOnly ? (
                      <span className="px-1">{ing?.name}</span>
                    ) : (
                      <IngredientPicker
                        value={l.ingredientId}
                        onChange={(i) => setLine(l.key, { ingredientId: i.id, unitMode: 'STOCK' })}
                      />
                    )}
                  </div>
                  <div className="col-span-2 md:col-span-1">
                    {ing?.purchaseUnit ? (
                      <Select
                        aria-label="Đơn vị"
                        disabled={readOnly}
                        value={l.unitMode}
                        onChange={(e) => setLine(l.key, { unitMode: e.target.value as Line['unitMode'] })}
                      >
                        <option value="STOCK">{ing.unit}</option>
                        <option value="PURCHASE">
                          {ing.purchaseUnit} (= {qty(ing.purchaseFactor)} {ing.unit})
                        </option>
                      </Select>
                    ) : (
                      <span className="px-1 text-[13px] text-muted">Đơn vị: {ing?.unit ?? '—'}</span>
                    )}
                  </div>
                  <label className="flex flex-col gap-1 md:block">
                    <span className="text-xs text-faint md:hidden">Số lượng</span>
                    <Input
                      disabled={readOnly}
                      inputMode="decimal"
                      className="num text-right"
                      value={l.qty}
                      onChange={(e) => setLine(l.key, { qty: e.target.value })}
                      aria-label="Số lượng"
                    />
                  </label>
                  <label className="flex flex-col gap-1 md:block">
                    <span className="text-xs text-faint md:hidden">Đơn giá</span>
                    <Input
                      disabled={readOnly}
                      inputMode="numeric"
                      className="num text-right"
                      value={l.unitPrice}
                      onChange={(e) => setLine(l.key, { unitPrice: e.target.value })}
                      aria-label="Đơn giá"
                    />
                  </label>
                  <div className="flex items-center justify-between md:block md:text-right">
                    <span className="text-xs text-faint md:hidden">Thành tiền</span>
                    <b className="num">{money(Math.round(q(l.qty) * m(l.unitPrice)))}</b>
                  </div>
                  <div className="flex justify-end">
                    {!readOnly && form.lines.length > 1 && (
                      <IconButton
                        label="Xoá dòng"
                        size={34}
                        onClick={() => setForm({ ...form, lines: form.lines.filter((x) => x.key !== l.key) })}
                      >
                        <Trash2 size={15} />
                      </IconButton>
                    )}
                  </div>
                </div>
              );
            })}
            <div className="flex items-center justify-between gap-3 border-t border-line bg-total-row px-3 py-2">
              {!readOnly ? (
                <Button
                  size="sm"
                  variant="tonal"
                  icon={<Plus size={15} />}
                  onClick={() => setForm({ ...form, lines: [...form.lines, emptyLine()] })}
                >
                  Thêm dòng
                </Button>
              ) : (
                <span />
              )}
              <span className="text-sm">
                Tổng <b className="ml-2 num">{money(total)}</b>
              </span>
            </div>
          </div>
          <Field label="Ghi chú">
            {(fid) => (
              <Input
                id={fid}
                disabled={readOnly}
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            )}
          </Field>
          {form.kind === 'PURCHASE' && (
            <div className="flex flex-col gap-2 border-t border-line pt-4">
              <span className="text-[13px] font-semibold text-ink-strong">Ảnh hoá đơn / chứng từ</span>
              {r ? (
                <ReceiptDocuments receipt={r} />
              ) : (
                <>
                  <FileGrid
                    files={[]}
                    pending={photos}
                    onOpen={() => {}}
                    onRemovePending={(i) => setPhotos((p) => p.filter((_, j) => j !== i))}
                  />
                  <AddFilesButtons
                    onFiles={(files) => setPhotos((p) => [...p, ...files])}
                    busy={progress !== null}
                    progress={progress}
                  />
                </>
              )}
            </div>
          )}
          <FormError message={create.error ? errorMessage(create.error) : null} />
        </div>
      )}

      <ReasonDialog
        open={askReason === 'update'}
        title="Lưu thay đổi phiếu nhập"
        onClose={() => setAskReason(null)}
        onConfirm={async (reason) => {
          ok(await client.inventory.updateReceipt({ params: { id: id! }, body: { ...body(), reason } }));
          done('Đã cập nhật phiếu nhập');
        }}
      />
      <ReasonDialog
        open={askReason === 'delete'}
        danger
        title="Xoá phiếu nhập"
        description="Các lô hàng của phiếu sẽ bị xoá khỏi kho."
        confirmLabel="Xoá phiếu"
        onClose={() => setAskReason(null)}
        onConfirm={async (reason) => {
          ok(await client.inventory.deleteReceipt({ params: { id: id! }, body: { reason } }));
          done('Đã xoá phiếu nhập');
        }}
      />
    </Dialog>
  );
}

export type { ReceiptDetail };
