import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/controls';
import { Field, Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { FormError } from '@/auth/AuthCard';
import { client, errorMessage, ok } from '@/lib/api-client';
import { ConnectStep, Note } from '@/features/documents/DriveConnect';

const CONSOLE = 'https://console.cloud.google.com';

/** Steps to create the OAuth client in Google Cloud (same as docs/setup-google-drive.md). */
function Guide() {
  return (
    <details className="rounded-ctl border border-line px-3 py-2 text-[13px]">
      <summary className="cursor-pointer font-medium text-ink">
        Cách lấy Client ID / Client secret (10 phút, một lần)
      </summary>
      <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-5 text-muted">
        <li>
          Mở{' '}
          <a className="text-primary-ink underline" href={CONSOLE} target="_blank" rel="noreferrer">
            console.cloud.google.com <ExternalLink size={12} className="inline" />
          </a>{' '}
          bằng tài khoản Google sẽ nhận file → chọn dự án ở thanh trên cùng → <b>New project</b> (vd “Ke toan
          quan”) → <b>Create</b>.
        </li>
        <li>
          <b>APIs &amp; Services → Library</b> → tìm <b>Google Drive API</b> → <b>Enable</b>.
        </li>
        <li>
          <b>Google Auth Platform</b> (hoặc <b>OAuth consent screen</b>): Branding — tên app “Kế toán quán”,
          email của bạn; Audience — <b>External</b> rồi bấm <b>Publish app</b> để sang <b>In production</b>{' '}
          (để ở Testing thì Google tự ngắt sau 7 ngày).
        </li>
        <li>
          <b>Clients</b> (hoặc <b>Credentials</b>) → <b>Create client</b> → Application type{' '}
          <b>TVs and Limited Input devices</b> (phải đúng loại này) → <b>Create</b>.
        </li>
        <li>Chép Client ID và Client secret vào 2 ô dưới đây → Lưu → Kết nối Google Drive.</li>
      </ol>
    </details>
  );
}

/** Settings card: Google OAuth client (Client ID / secret) and the Drive connection. */
export function GoogleDriveSection() {
  const qc = useQueryClient();
  const toast = useToast();
  const status = useQuery({
    queryKey: ['drive-status'],
    queryFn: async () => ok(await client.drive.status()),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['drive-status'] });
    qc.invalidateQueries({ queryKey: ['backups'] });
  };
  const [editing, setEditing] = useState(false);
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');

  const save = useMutation({
    mutationFn: async () =>
      ok(await client.drive.saveClient({ body: { clientId: clientId.trim(), clientSecret: secret.trim() } })),
    onSuccess: (s) => {
      qc.setQueryData(['drive-status'], s);
      refresh();
      setEditing(false);
      setSecret('');
      toast('Đã lưu thông tin Google');
    },
  });
  const clear = useMutation({
    mutationFn: async () => ok(await client.drive.clearClient({ body: {} })),
    onSuccess: (s) => {
      qc.setQueryData(['drive-status'], s);
      refresh();
      toast('Đã xoá thông tin Google');
    },
    onError: (e) => toast(errorMessage(e), 'bad'),
  });
  const disconnect = useMutation({
    mutationFn: async () => ok(await client.drive.disconnect({ body: {} })),
    onSuccess: () => {
      refresh();
      toast('Đã ngắt kết nối Google Drive');
    },
    onError: (e) => toast(errorMessage(e), 'bad'),
  });

  const s = status.data;
  // Links elsewhere point at /admin/system/settings#google-drive.
  const { hash } = useLocation();
  const anchor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (hash === '#google-drive' && s) anchor.current?.scrollIntoView({ behavior: 'smooth' });
  }, [hash, s]);
  const showForm = editing || (s && !s.configured);

  return (
    <div id="google-drive" ref={anchor} className="scroll-mt-20">
      <Card className="p-5">
        <h2 className="font-semibold text-ink-strong">Google Drive</h2>
        <p className="mt-0.5 text-[13px] text-muted">
          Gửi chứng từ và bản sao lưu dữ liệu lên Google Drive của bạn. App chỉ ghi được vào thư mục do nó
          tạo, không đọc được các file khác.
        </p>

        {s && (
          <div className="mt-4 flex flex-col gap-4">
            {/* 1. OAuth client */}
            {showForm ? (
              <div className="flex flex-col gap-3">
                <Guide />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Client ID">
                    {(id) => (
                      <Input
                        id={id}
                        value={clientId}
                        placeholder="1234567890-xxxx.apps.googleusercontent.com"
                        autoComplete="off"
                        onChange={(e) => setClientId(e.target.value)}
                      />
                    )}
                  </Field>
                  <Field label="Client secret" hint="Được mã hoá khi lưu, không hiện lại">
                    {(id, d) => (
                      <Input
                        id={id}
                        aria-describedby={d}
                        type="password"
                        value={secret}
                        placeholder="GOCSPX-…"
                        autoComplete="new-password"
                        onChange={(e) => setSecret(e.target.value)}
                      />
                    )}
                  </Field>
                </div>
                {s.connected && editing && (
                  <Note>Đổi sang Client ID khác sẽ ngắt kết nối hiện tại, cần kết nối lại.</Note>
                )}
                <FormError message={save.error ? errorMessage(save.error) : null} />
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    loading={save.isPending}
                    disabled={!clientId.trim() || !secret.trim()}
                    onClick={() => save.mutate()}
                  >
                    Lưu
                  </Button>
                  {editing && <Button onClick={() => setEditing(false)}>Huỷ</Button>}
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                <span className="min-w-0 break-all">
                  Client ID: <span className="num text-ink">{s.clientId}</span>
                  <span className="text-faint">
                    {s.clientSource === 'ENV'
                      ? ' · từ file cấu hình máy chủ (.env.prod)'
                      : ' · nhập trong Cài đặt'}
                  </span>
                </span>
                <span className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      setClientId(s.clientSource === 'ADMIN' ? (s.clientId ?? '') : '');
                      setEditing(true);
                    }}
                  >
                    {s.clientSource === 'ENV' ? 'Nhập Client khác' : 'Sửa'}
                  </Button>
                  {s.clientSource === 'ADMIN' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={clear.isPending}
                      onClick={() => clear.mutate()}
                    >
                      Xoá
                    </Button>
                  )}
                </span>
              </div>
            )}

            {/* 2. Connection */}
            {s.configured && !editing && (
              <div className="rounded-card border border-line p-4">
                {s.connected ? (
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
                ) : (
                  <ConnectStep onConnected={refresh} />
                )}
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
