import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { AlertTriangle, Lock, Paperclip, Plus, Trash2, UploadCloud } from 'lucide-react';
import { DOCUMENT_KINDS, changeRight, type ChangeRight, type DocumentKind } from '@ketoan/api/domain';
import {
  DOCUMENT_KIND_LABELS,
  type DocumentDetail,
  type DocumentInput,
  type DocumentSummary,
} from '@ketoan/api/contracts';
import { useAuth } from '@/auth/AuthProvider';
import { FormError } from '@/auth/AuthCard';
import { PageHeader } from '@/components/PageHeader';
import { MonthPicker, YearPicker, thisMonth, today } from '@/components/MonthPicker';
import { ReasonDialog } from '@/components/ReasonDialog';
import { Button } from '@/components/ui/Button';
import { Badge, Card, EmptyState, Segmented, Select, type BadgeTone } from '@/components/ui/controls';
import { DataTable } from '@/components/ui/DataTable';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { SearchInput } from '@/components/ui/SearchInput';
import { client, errorMessage, ok } from '@/lib/api-client';
import { dateVi, money, parseMoney } from '@/lib/format';
import { uploadFiles } from '@/lib/documents';
import {
  AddFilesButtons,
  ChangeConfirm,
  DocumentFilesPanel,
  FileGrid,
  FileThumb,
  uploadSummary,
} from './DocumentFiles';
import { DriveDialog } from './DriveDialog';

const KIND_TONE: Record<DocumentKind, BadgeTone> = { PURCHASE: 'primary', SALE: 'good', OTHER: 'neutral' };

export function KindBadge({ kind }: { kind: DocumentKind }) {
  return <Badge tone={KIND_TONE[kind]}>{DOCUMENT_KIND_LABELS[kind]}</Badge>;
}

export function DocumentsPage() {
  // Filters live in the URL so "back" and shared links keep the same month / year.
  const [params, setParams] = useSearchParams();
  const period = params.get('period') ?? thisMonth();
  const kind = (params.get('kind') as DocumentKind | null) ?? undefined;
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<number | 'new' | null>(null);
  const [backup, setBackup] = useState(false);
  const isAdmin = useAuth().user?.role === 'ADMIN';
  const byYear = period.length === 4;

  const set = (patch: Record<string, string | null>) =>
    setParams(
      (p) => {
        for (const [k, v] of Object.entries(patch)) {
          if (v) p.set(k, v);
          else p.delete(k);
        }
        return p;
      },
      { replace: true },
    );

  const q = search.trim() || undefined;
  const list = useQuery({
    queryKey: ['documents', period, kind, q],
    queryFn: async () => ok(await client.documents.list({ query: { period, kind, q } })),
    placeholderData: (prev) => prev,
  });
  const data = list.data;

  return (
    <div>
      <PageHeader
        title="Chứng từ"
        subtitle="Ảnh hoá đơn, chứng từ mua bán và file hoá đơn điện tử — lưu theo ngày, lọc theo tháng / năm"
        actions={
          <>
            {isAdmin && (
              <Button icon={<UploadCloud size={16} />} onClick={() => setBackup(true)}>
                Sao lưu / Google Drive
              </Button>
            )}
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setOpen('new')}>
              Thêm chứng từ
            </Button>
          </>
        }
      />
      {backup && <DriveDialog period={period} onClose={() => setBackup(false)} />}
      {!!data?.missingFiles && (
        <p className="mb-3 flex items-center gap-2 rounded-ctl bg-warn-soft px-3 py-2 text-[13px] text-warn">
          <AlertTriangle size={16} className="shrink-0" />
          {data.missingFiles} chứng từ trong {byYear ? 'năm' : 'tháng'} chưa có ảnh / file đính kèm
        </p>
      )}
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <Segmented
            label="Lọc theo"
            value={byYear ? 'year' : 'month'}
            onChange={(v) =>
              set({
                period: v === 'year' ? period.slice(0, 4) : `${period.slice(0, 4)}-${thisMonth().slice(5)}`,
              })
            }
            options={[
              { value: 'month', label: 'Tháng' },
              { value: 'year', label: 'Năm' },
            ]}
          />
          {byYear ? (
            <YearPicker value={Number(period)} onChange={(y) => set({ period: String(y) })} />
          ) : (
            <MonthPicker value={period} onChange={(m) => set({ period: m })} />
          )}
          <div className="w-36">
            <Select
              aria-label="Loại chứng từ"
              value={kind ?? ''}
              onChange={(e) => set({ kind: e.target.value || null })}
              className="h-9"
            >
              <option value="">Tất cả loại</option>
              {DOCUMENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {DOCUMENT_KIND_LABELS[k]}
                </option>
              ))}
            </Select>
          </div>
          <SearchInput
            className="w-full sm:w-56 h-9"
            aria-label="Tìm chứng từ"
            placeholder="Tìm số HĐ, đối tác, ghi chú"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {!!data?.rows.length && (
          <div className="flex flex-wrap gap-x-5 gap-y-1 border-b border-line px-4 py-2 text-[13px] text-muted">
            <span>
              <b className="text-ink">{data.rows.length}</b> chứng từ
            </span>
            {data.totals.map((t) => (
              <span key={t.kind}>
                {DOCUMENT_KIND_LABELS[t.kind]} ({t.count}): <b className="num text-ink">{money(t.amount)}</b>
              </span>
            ))}
          </div>
        )}
        <DataTable<DocumentSummary>
          rows={data?.rows}
          loading={list.isLoading}
          rowKey={(r) => r.id}
          onRowClick={(r) => setOpen(r.id)}
          empty={
            <EmptyState
              title={q ? 'Không tìm thấy chứng từ' : `Chưa có chứng từ trong ${byYear ? 'năm' : 'tháng'}`}
              hint="Chụp hoá đơn ngay khi nhận hàng để không bị thất lạc."
              action={
                <Button variant="tonal" icon={<Plus size={16} />} onClick={() => setOpen('new')}>
                  Thêm chứng từ
                </Button>
              }
            />
          }
          columns={[
            {
              key: 'doc',
              header: 'Chứng từ',
              cell: (r) => (
                <span className="flex items-center gap-3">
                  {r.cover ? (
                    <FileThumb file={r.cover} size={40} />
                  ) : (
                    <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-ctl border border-dashed border-warn text-warn">
                      <AlertTriangle size={16} aria-label="Chưa có ảnh" />
                    </span>
                  )}
                  <span className="flex min-w-0 flex-col">
                    <span className="flex items-center gap-1.5 font-medium">
                      {r.partner ?? '—'}
                      {r.locked && <Lock size={13} className="text-faint" aria-label="Đã khoá sổ" />}
                    </span>
                    {r.note && <span className="truncate text-xs text-faint">{r.note}</span>}
                  </span>
                </span>
              ),
            },
            { key: 'date', header: 'Ngày', cell: (r) => dateVi(r.date) },
            { key: 'kind', header: 'Loại', cell: (r) => <KindBadge kind={r.kind} /> },
            { key: 'number', header: 'Số hoá đơn', secondary: true, cell: (r) => r.number ?? '—' },
            {
              key: 'files',
              header: 'File',
              align: 'right',
              cell: (r) => (
                <span className="inline-flex items-center gap-1 text-muted">
                  <Paperclip size={13} /> {r.fileCount}
                </span>
              ),
            },
            {
              key: 'receipt',
              header: 'Phiếu nhập',
              secondary: true,
              cell: (r) =>
                r.receiptId ? (
                  <span className="text-primary-ink">PN{String(r.receiptId).padStart(6, '0')}</span>
                ) : (
                  '—'
                ),
            },
            { key: 'by', header: 'Người tạo', secondary: true, cell: (r) => r.createdBy },
            {
              key: 'amount',
              header: 'Số tiền',
              align: 'right',
              cell: (r) => (r.amount === null ? '—' : <b className="num">{money(r.amount)}</b>),
            },
          ]}
        />
      </Card>
      {open !== null && (
        <DocumentEditor
          id={open === 'new' ? null : open}
          defaultDate={today().startsWith(period) ? today() : byYear ? `${period}-01-01` : `${period}-01`}
          defaultKind={kind}
          onClose={() => setOpen(null)}
          onCreated={(id) => setOpen(id)}
        />
      )}
    </div>
  );
}

interface Form {
  kind: DocumentKind;
  date: string;
  number: string;
  partner: string;
  amount: string;
  note: string;
}

const toForm = (d: DocumentDetail): Form => ({
  kind: d.kind,
  date: d.date,
  number: d.number ?? '',
  partner: d.partner ?? '',
  amount: d.amount === null ? '' : money(d.amount),
  note: d.note ?? '',
});

export function DocumentEditor({
  id,
  defaultDate,
  defaultKind,
  onClose,
  onCreated,
}: {
  id: number | null;
  defaultDate: string;
  defaultKind?: DocumentKind;
  onClose: () => void;
  /** New document saved but some files failed: keep it open on the saved document. */
  onCreated: (id: number) => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const partners = useQuery({
    queryKey: ['document-partners'],
    queryFn: async () => ok(await client.documents.partners()),
  });
  const existing = useQuery({
    queryKey: ['document', id],
    enabled: id !== null,
    queryFn: async () => ok(await client.documents.get({ params: { id: id! } })),
  });
  const d = existing.data;

  const [form, setForm] = useState<Form | null>(
    id === null
      ? { kind: defaultKind ?? 'PURCHASE', date: defaultDate, number: '', partner: '', amount: '', note: '' }
      : null,
  );
  if (id !== null && d && !form) setForm(toForm(d));
  const [pending, setPending] = useState<File[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [askReason, setAskReason] = useState<'update' | 'delete' | null>(null);

  // Creator: free edits for 24 h; ADMIN: any time, with a reason. Locked month: nobody.
  const right: ChangeRight = !d || !user || d.locked ? 'NO' : changeRight(user, d);
  const readOnly = id !== null && right === 'NO';
  const amount = form ? parseMoney(form.amount) : NaN;

  const body = (): DocumentInput => ({
    kind: form!.kind,
    date: form!.date,
    number: form!.number.trim() || null,
    partner: form!.partner.trim() || null,
    amount: form!.amount.trim() && Number.isFinite(amount) ? String(amount) : null,
    note: form!.note.trim() || null,
    receiptId: d?.receiptId ?? null,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['documents'] });
    void qc.invalidateQueries({ queryKey: ['document-partners'] });
    void qc.invalidateQueries({ queryKey: ['receipts'] });
  };

  const create = useMutation({
    mutationFn: async () => {
      const doc = ok(await client.documents.create({ body: body() }));
      const r = pending.length
        ? await uploadFiles(doc.id, pending, (n, t) => setProgress(`Đang tải lên ${n + 1}/${t}…`))
        : null;
      return { doc, r };
    },
    onSettled: () => setProgress(null),
    onSuccess: ({ doc, r }) => {
      refresh();
      if (r?.failed.length) {
        toast(uploadSummary(r), 'bad');
        onCreated(doc.id);
      } else {
        toast(r ? `Đã lưu chứng từ và ${r.uploaded} file` : 'Đã lưu chứng từ');
        onClose();
      }
    },
  });

  const save = useMutation({
    mutationFn: async (reason?: string) =>
      ok(await client.documents.update({ params: { id: id! }, body: { ...body(), reason } })),
    onSuccess: () => {
      refresh();
      void qc.invalidateQueries({ queryKey: ['document', id] });
      toast('Đã cập nhật chứng từ');
      onClose();
    },
  });

  const title = id === null ? 'Thêm chứng từ' : `Chứng từ ngày ${d ? dateVi(d.date) : ''}`;
  const set = (patch: Partial<Form>) => setForm((f) => f && { ...f, ...patch });

  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      width={760}
      footer={
        id === null ? (
          <>
            <Button onClick={onClose}>Huỷ bỏ</Button>
            <Button
              variant="primary"
              loading={create.isPending}
              disabled={!form?.date || (!!form.amount.trim() && !Number.isFinite(amount))}
              onClick={() => create.mutate()}
            >
              Lưu chứng từ
            </Button>
          </>
        ) : readOnly ? (
          <Button onClick={onClose}>Đóng</Button>
        ) : (
          <>
            <Button
              variant="danger"
              icon={<Trash2 size={16} />}
              className="mr-auto"
              onClick={() => setAskReason('delete')}
            >
              Xoá
            </Button>
            <Button onClick={onClose}>Đóng</Button>
            <Button
              variant="primary"
              loading={save.isPending}
              disabled={!form}
              onClick={() => (right === 'WITH_REASON' ? setAskReason('update') : save.mutate(undefined))}
            >
              Lưu thay đổi
            </Button>
          </>
        )
      }
    >
      {!form ? (
        <p className="text-muted">Đang tải…</p>
      ) : (
        <div className="flex flex-col gap-4">
          {id !== null && d?.locked && (
            <p className="rounded-ctl bg-warn-soft px-3 py-2 text-[13px] text-warn">
              Tháng này đã khoá sổ — không sửa / xoá được, nhưng vẫn đính kèm thêm ảnh được.
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium">Loại chứng từ</span>
              <Segmented
                label="Loại chứng từ"
                value={form.kind}
                onChange={(k) => !readOnly && set({ kind: k })}
                options={DOCUMENT_KINDS.map((k) => ({ value: k, label: DOCUMENT_KIND_LABELS[k] }))}
              />
            </div>
            <Field label="Ngày chứng từ">
              {(fid) => (
                <Input
                  id={fid}
                  type="date"
                  disabled={readOnly}
                  value={form.date}
                  onChange={(e) => set({ date: e.target.value })}
                />
              )}
            </Field>
            <Field label={form.kind === 'SALE' ? 'Khách hàng' : 'Nhà cung cấp / đối tác'}>
              {(fid) => (
                <>
                  <Input
                    id={fid}
                    list="document-partners"
                    disabled={readOnly}
                    value={form.partner}
                    onChange={(e) => set({ partner: e.target.value })}
                  />
                  <datalist id="document-partners">
                    {partners.data?.map((p) => (
                      <option key={p} value={p} />
                    ))}
                  </datalist>
                </>
              )}
            </Field>
            <Field label="Số hoá đơn">
              {(fid) => (
                <Input
                  id={fid}
                  disabled={readOnly}
                  value={form.number}
                  onChange={(e) => set({ number: e.target.value })}
                />
              )}
            </Field>
            <Field
              label="Số tiền (₫)"
              error={form.amount.trim() && !Number.isFinite(amount) ? 'Số tiền không hợp lệ' : undefined}
            >
              {(fid, desc) => (
                <Input
                  id={fid}
                  aria-describedby={desc}
                  inputMode="numeric"
                  className="num"
                  disabled={readOnly}
                  value={form.amount}
                  onChange={(e) => set({ amount: e.target.value })}
                  onBlur={() =>
                    Number.isFinite(amount) && form.amount.trim() && set({ amount: money(amount) })
                  }
                />
              )}
            </Field>
            <Field label="Ghi chú">
              {(fid) => (
                <Input
                  id={fid}
                  disabled={readOnly}
                  value={form.note}
                  onChange={(e) => set({ note: e.target.value })}
                />
              )}
            </Field>
          </div>
          {d?.receiptId && (
            <p className="text-[13px] text-muted">
              Gắn với phiếu nhập <b className="text-primary-ink">PN{String(d.receiptId).padStart(6, '0')}</b>
            </p>
          )}

          <div className="flex flex-col gap-2 border-t border-line pt-4">
            <span className="text-[13px] font-semibold text-ink-strong">Ảnh / file hoá đơn</span>
            {id === null ? (
              <>
                <FileGrid
                  files={[]}
                  pending={pending}
                  onOpen={() => {}}
                  onRemovePending={(i) => setPending((p) => p.filter((_, j) => j !== i))}
                />
                <AddFilesButtons
                  onFiles={(files) => setPending((p) => [...p, ...files])}
                  busy={progress !== null}
                  progress={progress}
                />
                <p className="text-xs text-faint">
                  Ảnh được nén tự động (giữ đủ nét để đọc chữ). Nhận cả PDF / XML hoá đơn điện tử, tối đa 10
                  MB mỗi file.
                </p>
              </>
            ) : (
              <DocumentFilesPanel documentId={id} locked={!!d?.locked} />
            )}
          </div>
          <FormError
            message={create.error ? errorMessage(create.error) : save.error ? errorMessage(save.error) : null}
          />
        </div>
      )}

      <ReasonDialog
        open={askReason === 'update'}
        title="Lưu thay đổi chứng từ"
        onClose={() => setAskReason(null)}
        onConfirm={async (reason) => {
          await save.mutateAsync(reason);
        }}
      />
      <ChangeConfirm
        open={askReason === 'delete'}
        right={right}
        title="Xoá chứng từ"
        description="Chứng từ được ẩn khỏi danh sách; ảnh vẫn được giữ trên máy chủ và ghi vào lịch sử sửa."
        confirmLabel="Xoá chứng từ"
        onClose={() => setAskReason(null)}
        onConfirm={async (reason) => {
          ok(await client.documents.remove({ params: { id: id! }, body: { reason } }));
          refresh();
          toast('Đã xoá chứng từ');
          onClose();
        }}
      />
    </Dialog>
  );
}
