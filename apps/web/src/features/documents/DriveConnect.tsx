import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Copy, ExternalLink } from 'lucide-react';
import type { DeviceCode } from '@ketoan/api/contracts';
import { Button, IconButton, Spinner } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { client, errorMessage, ok } from '@/lib/api-client';

export function Note({
  tone = 'muted',
  children,
}: {
  tone?: 'muted' | 'bad' | 'good';
  children: React.ReactNode;
}) {
  const cls =
    tone === 'bad'
      ? 'bg-bad-soft text-bad-ink'
      : tone === 'good'
        ? 'bg-good-soft text-good'
        : 'bg-track text-muted';
  return <div className={`rounded-ctl px-3 py-2 text-[13px] ${cls}`}>{children}</div>;
}

/** Sign-in by code: show the code, poll the server until Google confirms (or the code expires). */
export function ConnectStep({ onConnected }: { onConnected: () => void }) {
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
