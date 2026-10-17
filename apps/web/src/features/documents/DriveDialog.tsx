import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Copy, Download, ExternalLink, UploadCloud } from 'lucide-react';
import type { DeviceCode } from '@ketoan/api/contracts';
import { Button, IconButton, Spinner } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { useToast } from '@/components/ui/Toast';
import { client, errorMessage, ok } from '@/lib/api-client';
import { fileSize } from '@/lib/documents';

/** "2026-10" → "tháng 10/2026", "2026" → "năm 2026". */
export const periodLabel = (period: string) =>
  period.length === 4 ? `năm ${period}` : `tháng ${Number(period.slice(5))}/${period.slice(0, 4)}`;

/** The browser downloads the .zip itself (streamed to disk) through a 2-minute signed link. */
export async function downloadZip(period: string) {
  const { url, fileName } = ok(await client.documents.exportLink({ body: { period } }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
}

function Note({ tone = 'muted', children }: { tone?: 'muted' | 'bad' | 'good'; children: React.ReactNode }) {
  const cls =
    tone === 'bad'
      ? 'bg-bad-soft text-bad-ink'
      : tone === 'good'
        ? 'bg-good-soft text-good'
        : 'bg-track text-muted';
  return <div className={`rounded-ctl px-3 py-2 text-[13px] ${cls}`}>{children}</div>;
}

/** Sign-in by code: show the code, poll the server until Google confirms (or the code expires). */
function ConnectStep({ onConnected }: { onConnected: () => void }) {
  const toast = useToast();
  const [code, setCode] = useState<DeviceCode | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const start = useMutation({
    mutationFn: async () => ok(await client.drive.connect({ body: {} })),
    onSuccess: (c) => {
      setProblem(null);
      setCode(c);
    },
    onError: (e) => setProblem(errorMessage(e)),
  });

  useEffect(() => {
    if (!code) return;
    let stop = false;
    const timer = setInterval(
      async () => {
        try {
          const r = ok(await client.drive.poll({ body: {} }));
          if (stop || r.state === 'PENDING') return;
          setCode(null);
          if (r.state === 'CONNECTED') {
            toast(`Đã kết nối Google Drive${r.status.email ? `: ${r.status.email}` : ''}`);
            onConnected();
          } else
            setProblem(
              r.state === 'DENIED'
                ? 'Bạn đã từ chối cấp quyền trên Google.'
                : 'Mã đã hết hạn, hãy lấy mã mới.',
            );
        } catch (e) {
          setCode(null);
          setProblem(errorMessage(e));
        }
      },
      Math.max(code.interval, 3) * 1000,
    );
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [code, onConnected, toast]);

  if (!code)
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-muted">
          Kết nối một lần với tài khoản Google của bạn. App chỉ được ghi vào thư mục do nó tạo ra, không đọc
          được các file khác trong Drive.
        </p>
        {problem && <Note tone="bad">{problem}</Note>}
        <div>
          <Button variant="primary" loading={start.isPending} onClick={() => start.mutate()}>
            Kết nối Google Drive
          </Button>
        </div>
      </div>
    );

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <p className="text-[13px] text-muted">
        Trên điện thoại hoặc máy tính, mở trang dưới đây, đăng nhập Google rồi nhập mã:
      </p>
      <a
        href={code.verificationUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 font-semibold text-primary-ink hover:underline"
      >
        {code.verificationUrl.replace(/^https:\/\//, '')} <ExternalLink size={14} />
      </a>
      <div className="flex items-center gap-2">
        <span className="rounded-card border border-line bg-primary-soft px-5 py-3 font-mono text-2xl font-bold tracking-[0.2em] text-ink-strong">
          {code.userCode}
        </span>
        <IconButton
          label="Chép mã"
          onClick={() => void navigator.clipboard?.writeText(code.userCode).then(() => toast('Đã chép mã'))}
        >
          <Copy size={16} />
        </IconButton>
      </div>
      <p className="inline-flex items-center gap-2 text-[13px] text-muted">
        <Spinner /> Đang chờ bạn xác nhận trên Google…
      </p>
      <p className="text-xs text-faint">
        Mã hết hạn lúc {new Date(code.expiresAt).toLocaleTimeString('vi-VN', { timeStyle: 'short' })}
      </p>
    </div>
  );
}

export function DriveDialog({ period, onClose }: { period: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const status = useQuery({
    queryKey: ['drive-status'],
    queryFn: async () => ok(await client.drive.status()),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['drive-status'] });

  const upload = useMutation({
    mutationFn: async () => ok(await client.drive.uploadDocuments({ body: { period } })),
    onError: () => refresh(),
  });
  const disconnect = useMutation({
    mutationFn: async () => ok(await client.drive.disconnect({ body: {} })),
    onSuccess: () => {
      refresh();
      upload.reset();
      toast('Đã ngắt kết nối Google Drive');
    },
  });
  const download = useMutation({
    mutationFn: () => downloadZip(period),
    onError: (e) => toast(errorMessage(e), 'bad'),
  });

  const s = status.data;
  const label = periodLabel(period);

  return (
    <Dialog
      open
      onClose={onClose}
      title="Sao lưu chứng từ"
      width={560}
      footer={
        <>
          <Button
            icon={<Download size={16} />}
            className="mr-auto"
            loading={download.isPending}
            onClick={() => download.mutate()}
          >
            Tải file nén về máy
          </Button>
          <Button onClick={onClose}>Đóng</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-[13px] text-muted">
          Nén toàn bộ ảnh / file chứng từ <b className="text-ink">{label}</b> thành một file .zip (mỗi chứng
          từ một thư mục, kèm file Excel danh sách).
        </p>

        <div className="flex flex-col gap-3 rounded-card border border-line p-4">
          <span className="flex items-center gap-2 font-semibold text-ink-strong">
            <UploadCloud size={18} className="text-primary-ink" /> Google Drive của bạn
          </span>
          {!s ? (
            <Spinner className="text-primary-ink" />
          ) : !s.configured ? (
            <Note>
              Máy chủ chưa được thiết lập Google Drive. Người cài đặt làm theo hướng dẫn{' '}
              <b>docs/setup-google-drive.md</b> (khoảng 10 phút, một lần). Trong lúc chờ, bạn có thể tải file
              nén về máy rồi tự tải lên Drive.
            </Note>
          ) : !s.connected ? (
            <ConnectStep onConnected={refresh} />
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                <span className="inline-flex items-center gap-1.5 text-good">
                  <CheckCircle2 size={16} /> Đã kết nối{s.email ? `: ${s.email}` : ''}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={disconnect.isPending}
                  onClick={() => disconnect.mutate()}
                >
                  Ngắt kết nối
                </Button>
              </div>
              <div>
                <Button
                  variant="primary"
                  icon={<UploadCloud size={16} />}
                  loading={upload.isPending}
                  onClick={() => upload.mutate()}
                >
                  Gửi chứng từ {label} lên Drive
                </Button>
              </div>
              {upload.isPending && (
                <Note>Đang nén và tải lên… có thể mất vài phút nếu nhiều ảnh. Đừng đóng trang.</Note>
              )}
              {upload.isError && <Note tone="bad">{errorMessage(upload.error)}</Note>}
              {upload.data && (
                <Note tone="good">
                  Đã gửi <b>{upload.data.fileName}</b> ({upload.data.documents} chứng từ, {upload.data.files}{' '}
                  file, {fileSize(upload.data.bytes)}) vào thư mục “Kế toán quán - Chứng từ”.{' '}
                  {upload.data.link && (
                    <a
                      href={upload.data.link}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold underline"
                    >
                      Mở trên Google Drive
                    </a>
                  )}
                </Note>
              )}
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
