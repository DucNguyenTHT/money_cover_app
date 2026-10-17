import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileCode2,
  FileText,
  Paperclip,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import type { DocumentFileDto } from '@ketoan/api/contracts';
import { changeRight, type ChangeRight } from '@ketoan/api/domain';
import { useAuth } from '@/auth/AuthProvider';
import { ReasonDialog } from '@/components/ReasonDialog';
import { Button, IconButton, Spinner } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { useToast } from '@/components/ui/Toast';
import { client, errorMessage, ok } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import {
  ACCEPT_FILES,
  attachToReceipt,
  downloadFile,
  fileKind,
  fileSize,
  uploadFiles,
  useFileUrl,
  type UploadResult,
} from '@/lib/documents';

/** Square preview: photo thumbnail, or a PDF / XML badge. */
export function FileThumb({
  file,
  size = 96,
  className,
}: {
  file: Pick<DocumentFileDto, 'id' | 'mime' | 'hasThumb'>;
  size?: number;
  className?: string;
}) {
  const kind = fileKind(file.mime);
  const thumb = useFileUrl(kind === 'image' ? file.id : null, file.hasThumb);
  return (
    <span
      style={{ width: size, height: size }}
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-ctl border border-line bg-track',
        className,
      )}
    >
      {kind === 'image' ? (
        thumb.data ? (
          <img src={thumb.data.url} alt="" className="size-full object-cover" />
        ) : (
          <Spinner className="size-4 text-faint" />
        )
      ) : (
        <span className="flex flex-col items-center gap-0.5 text-primary-ink">
          {kind === 'pdf' ? (
            <FileText size={size > 48 ? 26 : 16} />
          ) : (
            <FileCode2 size={size > 48 ? 26 : 16} />
          )}
          {size > 48 && <span className="text-[11px] font-semibold uppercase">{kind}</span>}
        </span>
      )}
    </span>
  );
}

/** A picked file waiting for its document to be saved. */
function PendingThumb({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file.type.startsWith('image/')) return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return (
    <div className="relative flex w-24 flex-col gap-1">
      <span className="inline-flex size-24 items-center justify-center overflow-hidden rounded-ctl border border-dashed border-primary bg-primary-soft">
        {url ? (
          <img src={url} alt="" className="size-full object-cover" />
        ) : (
          <FileText size={26} className="text-primary-ink" />
        )}
      </span>
      <span className="truncate text-xs text-muted" title={file.name}>
        {file.name}
      </span>
      <button
        type="button"
        aria-label={`Bỏ ${file.name}`}
        onClick={onRemove}
        className="absolute right-1 top-1 inline-flex size-6 items-center justify-center rounded-full bg-white/90 text-muted shadow"
      >
        <X size={14} />
      </button>
    </div>
  );
}

/** "Chụp ảnh" (opens the phone camera) + "Chọn file" (photos, PDF, XML; several at once). */
export function AddFilesButtons({
  onFiles,
  busy,
  progress,
}: {
  onFiles: (files: File[]) => void;
  busy?: boolean;
  progress?: string | null;
}) {
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    if (files.length) onFiles(files);
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="tonal"
        icon={<Camera size={16} />}
        disabled={busy}
        onClick={() => camera.current?.click()}
        className="lg:hidden"
      >
        Chụp ảnh
      </Button>
      <Button
        type="button"
        variant="secondary"
        icon={<Paperclip size={16} />}
        disabled={busy}
        onClick={() => picker.current?.click()}
      >
        Thêm ảnh / file (chọn được nhiều)
      </Button>
      {busy && (
        <span className="inline-flex items-center gap-2 text-[13px] text-muted">
          <Spinner /> {progress ?? 'Đang tải lên…'}
        </span>
      )}
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      <input ref={picker} type="file" accept={ACCEPT_FILES} multiple hidden onChange={pick} />
    </div>
  );
}

/** Grid of files already stored + files picked but not uploaded yet. */
export function FileGrid({
  files,
  pending = [],
  onOpen,
  onRemovePending,
  actions,
}: {
  files: DocumentFileDto[];
  pending?: File[];
  onOpen: (index: number) => void;
  onRemovePending?: (index: number) => void;
  /** Small buttons over a stored file's tile (replace / delete). */
  actions?: (file: DocumentFileDto) => ReactNode;
}) {
  if (!files.length && !pending.length)
    return <p className="text-[13px] text-faint">Chưa có ảnh / file nào.</p>;
  return (
    <div className="flex flex-wrap gap-3">
      {files.map((f, i) => (
        <div key={f.id} className="relative w-24">
          <button
            type="button"
            onClick={() => onOpen(i)}
            className="flex w-24 flex-col gap-1 text-left"
            title={`${f.name} · ${fileSize(f.size)}`}
          >
            <FileThumb file={f} className="transition-shadow hover:ring-4 hover:ring-primary/15" />
            <span className="truncate text-xs text-muted">{f.name}</span>
          </button>
          {actions && <div className="absolute right-1 top-1 flex gap-1">{actions(f)}</div>}
        </div>
      ))}
      {pending.map((f, i) => (
        <PendingThumb key={`${f.name}-${i}`} file={f} onRemove={() => onRemovePending?.(i)} />
      ))}
    </div>
  );
}

function XmlText({ blob }: { blob: Blob }) {
  const [text, setText] = useState('');
  useEffect(() => {
    void blob.text().then(setText);
  }, [blob]);
  return (
    <pre className="max-h-[65dvh] overflow-auto whitespace-pre-wrap break-all rounded-ctl bg-track p-3 text-xs">
      {text}
    </pre>
  );
}

/** Full-size viewer: photo (tap to zoom), PDF, or XML text; prev / next with ← →. */
export function FileViewer({
  files,
  index,
  onIndex,
  onClose,
  canRemove,
  onRemove,
}: {
  files: DocumentFileDto[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  canRemove?: boolean;
  onRemove?: (f: DocumentFileDto) => void;
}) {
  const f = files[index]!;
  const kind = fileKind(f.mime);
  const full = useFileUrl(f.id);
  const [zoom, setZoom] = useState(false);
  const toast = useToast();

  useEffect(() => setZoom(false), [index]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
      if (e.key === 'ArrowRight' && index < files.length - 1) onIndex(index + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, files.length, onIndex]);

  return (
    <Dialog
      open
      onClose={onClose}
      title={`${f.name} (${index + 1}/${files.length})`}
      width={1040}
      footer={
        <>
          {canRemove && (
            <Button
              variant="danger"
              icon={<Trash2 size={16} />}
              className="mr-auto"
              onClick={() => onRemove?.(f)}
            >
              Xoá file
            </Button>
          )}
          {kind === 'pdf' && full.data && (
            <Button icon={<ExternalLink size={16} />} onClick={() => window.open(full.data.url, '_blank')}>
              Mở tab mới
            </Button>
          )}
          <Button
            variant="primary"
            icon={<Download size={16} />}
            onClick={() => downloadFile(f).catch((e: unknown) => toast(errorMessage(e), 'bad'))}
          >
            Tải về
          </Button>
        </>
      }
    >
      <div className="relative">
        <p className="mb-2 text-xs text-faint">
          {fileSize(f.size)} · tải lên bởi {f.createdBy || '—'} lúc{' '}
          {new Date(f.createdAt).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}
        </p>
        {full.isError ? (
          <p className="rounded-ctl bg-bad-soft px-3 py-2 text-[13px] text-bad-ink">
            {errorMessage(full.error)}
          </p>
        ) : !full.data ? (
          <div className="flex h-64 items-center justify-center text-primary-ink">
            <Spinner className="size-6" />
          </div>
        ) : kind === 'image' ? (
          <div
            className={cn(
              'rounded-ctl bg-track',
              zoom ? 'max-h-[70dvh] overflow-auto' : 'flex justify-center',
            )}
          >
            <img
              src={full.data.url}
              alt={f.name}
              onClick={() => setZoom((z) => !z)}
              className={cn(
                zoom
                  ? 'max-w-none cursor-zoom-out'
                  : 'max-h-[70dvh] max-w-full cursor-zoom-in object-contain',
              )}
            />
          </div>
        ) : kind === 'pdf' ? (
          <iframe
            title={f.name}
            src={full.data.url}
            className="h-[70dvh] w-full rounded-ctl border border-line"
          />
        ) : (
          <XmlText blob={full.data.blob} />
        )}
        {files.length > 1 && (
          <>
            <IconButton
              label="Trước"
              disabled={index === 0}
              onClick={() => onIndex(index - 1)}
              className="absolute left-2 top-1/2 -translate-y-1/2"
            >
              <ChevronLeft size={18} />
            </IconButton>
            <IconButton
              label="Sau"
              disabled={index === files.length - 1}
              onClick={() => onIndex(index + 1)}
              className="absolute right-2 top-1/2 -translate-y-1/2"
            >
              <ChevronRight size={18} />
            </IconButton>
          </>
        )}
      </div>
    </Dialog>
  );
}

/**
 * Confirm a delete / change. `FREE` (uploader within 24 h) = simple confirm; `WITH_REASON` (ADMIN) = the
 * reason box written to the audit log.
 */
export function ChangeConfirm({
  right,
  open,
  title,
  description,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  right: ChangeRight;
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: (reason?: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (right === 'WITH_REASON')
    return (
      <ReasonDialog
        open={open}
        danger
        title={title}
        description={description}
        confirmLabel={confirmLabel}
        onClose={onClose}
        onConfirm={onConfirm}
      />
    );
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      width={420}
      footer={
        <>
          <Button onClick={onClose}>Huỷ bỏ</Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm();
                onClose();
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-[13px] text-muted">{description}</p>
      {error && <p className="mt-3 rounded-ctl bg-bad-soft px-3 py-2 text-[13px] text-bad-ink">{error}</p>}
    </Dialog>
  );
}

export const uploadSummary = (r: UploadResult) =>
  r.failed.length
    ? `${r.uploaded} file đã lưu, ${r.failed.length} file lỗi: ` +
      r.failed.map((f) => `${f.name} (${f.message})`).join('; ')
    : `Đã lưu ${r.uploaded} file`;

/** Invoice photos of a saved stock receipt (shown inside the receipt dialog). */
export function ReceiptDocuments({
  receipt,
}: {
  receipt: { id: number; date: string; supplier: string | null; total: string; locked: boolean };
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const docs = useQuery({
    queryKey: ['documents', 'receipt', receipt.id],
    queryFn: async () => ok(await client.documents.list({ query: { receiptId: receipt.id } })),
  });
  const [progress, setProgress] = useState<string | null>(null);
  const [errors, setErrors] = useState<string | null>(null);

  if (docs.isLoading) return <Spinner className="text-primary-ink" />;
  const rows = docs.data?.rows ?? [];
  if (rows.length)
    return (
      <div className="flex flex-col gap-4">
        {rows.map((d) => (
          <DocumentFilesPanel key={d.id} documentId={d.id} locked={d.locked} />
        ))}
      </div>
    );
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px] text-faint">Chưa có ảnh hoá đơn cho phiếu này.</p>
      <AddFilesButtons
        busy={progress !== null}
        progress={progress}
        onFiles={async (files) => {
          setErrors(null);
          try {
            const r = await attachToReceipt(receipt, files, (d, t) =>
              setProgress(`Đang tải lên ${d + 1}/${t}…`),
            );
            if (r.failed.length) setErrors(uploadSummary(r));
            else toast(uploadSummary(r));
          } catch (e) {
            setErrors(errorMessage(e));
          } finally {
            setProgress(null);
            void qc.invalidateQueries({ queryKey: ['documents'] });
            void qc.invalidateQueries({ queryKey: ['receipts'] });
          }
        }}
      />
      {errors && <p className="rounded-ctl bg-bad-soft px-3 py-2 text-[13px] text-bad-ink">{errors}</p>}
    </div>
  );
}

/** Files of one saved document: view and add (anyone); replace / delete (uploader for 24 h, or ADMIN). */
export function DocumentFilesPanel({ documentId, locked }: { documentId: number; locked: boolean }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const doc = useQuery({
    queryKey: ['document', documentId],
    queryFn: async () => ok(await client.documents.get({ params: { id: documentId } })),
  });
  const [viewing, setViewing] = useState<number | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [errors, setErrors] = useState<string | null>(null);
  const [removing, setRemoving] = useState<DocumentFileDto | null>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState<DocumentFileDto | null>(null);
  const rightFor = (f: DocumentFileDto): ChangeRight => (locked || !user ? 'NO' : changeRight(user, f));

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['document', documentId] });
    void qc.invalidateQueries({ queryKey: ['documents'] });
    void qc.invalidateQueries({ queryKey: ['receipts'] });
  };

  const add = async (files: File[]) => {
    setErrors(null);
    const r = await uploadFiles(documentId, files, (d, t) => setProgress(`Đang tải lên ${d + 1}/${t}…`));
    setProgress(null);
    refresh();
    if (r.failed.length) setErrors(uploadSummary(r));
    else toast(uploadSummary(r));
  };

  const remove = async (f: DocumentFileDto, reason?: string) => {
    ok(await client.documents.removeFile({ params: { id: documentId, fileId: f.id }, body: { reason } }));
    refresh();
  };

  /** New file first, old one removed only once the new one is safely stored. */
  const replace = async (old: DocumentFileDto, file: File) => {
    setErrors(null);
    setProgress(`Đang thay ${old.name}…`);
    try {
      const r = await uploadFiles(documentId, [file]);
      if (r.failed.length) return setErrors(uploadSummary(r));
      await remove(old, rightFor(old) === 'WITH_REASON' ? `Thay bằng file mới: ${file.name}` : undefined);
      toast('Đã thay file');
    } catch (e) {
      setErrors(errorMessage(e));
    } finally {
      setProgress(null);
      refresh();
    }
  };

  const files = doc.data?.files ?? [];
  const busy = progress !== null;
  return (
    <div className="flex flex-col gap-3">
      <FileGrid
        files={files}
        onOpen={setViewing}
        actions={(f) =>
          rightFor(f) !== 'NO' && (
            <>
              <IconButton
                label={`Thay ${f.name}`}
                size={28}
                disabled={busy}
                onClick={() => {
                  setReplacing(f);
                  replaceInput.current?.click();
                }}
              >
                <RefreshCw size={14} />
              </IconButton>
              <IconButton label={`Xoá ${f.name}`} size={28} disabled={busy} onClick={() => setRemoving(f)}>
                <Trash2 size={14} className="text-bad-ink" />
              </IconButton>
            </>
          )
        }
      />
      <input
        ref={replaceInput}
        type="file"
        accept={ACCEPT_FILES}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file && replacing) void replace(replacing, file);
        }}
      />
      <AddFilesButtons onFiles={add} busy={busy} progress={progress} />
      {errors && <p className="rounded-ctl bg-bad-soft px-3 py-2 text-[13px] text-bad-ink">{errors}</p>}
      {viewing !== null && files[viewing] && (
        <FileViewer
          files={files}
          index={viewing}
          onIndex={setViewing}
          onClose={() => setViewing(null)}
          canRemove={rightFor(files[viewing]) !== 'NO'}
          onRemove={setRemoving}
        />
      )}
      {removing && (
        <ChangeConfirm
          open
          right={rightFor(removing)}
          title="Xoá file khỏi chứng từ"
          description={`Xoá "${removing.name}"? File được ẩn đi nhưng vẫn giữ trên máy chủ và trong lịch sử sửa.`}
          confirmLabel="Xoá file"
          onClose={() => setRemoving(null)}
          onConfirm={async (reason) => {
            await remove(removing, reason);
            setViewing(null);
            toast('Đã xoá file');
          }}
        />
      )}
    </div>
  );
}
