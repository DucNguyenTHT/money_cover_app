import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { CheckCircle2, Download, UploadCloud } from 'lucide-react';
import { Button, Spinner } from '@/components/ui/Button';
import { ConnectStep, Note } from './DriveConnect';
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
              Chưa thiết lập Google Drive. Nhập Client ID / Client secret ở{' '}
              <Link className="font-semibold underline" to="/admin/system/settings#google-drive">
                Hệ thống → Cài đặt → Google Drive
              </Link>{' '}
              (có hướng dẫn từng bước, khoảng 10 phút, một lần). Trong lúc chờ, bạn có thể tải file nén về máy
              rồi tự tải lên Drive.
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
