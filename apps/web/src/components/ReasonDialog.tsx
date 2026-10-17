import { useState, type ReactNode } from 'react';
import { Dialog } from './ui/Dialog';
import { Button } from './ui/Button';
import { FormError } from '@/auth/AuthCard';

/** Ask for a reason (≥ 5 chars) before an edit / delete / reset that is written to the audit log. */
export function ReasonDialog({
  open,
  title,
  description,
  confirmLabel = 'Xác nhận',
  danger,
  extra,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  /** Extra fields rendered above the reason box. */
  extra?: ReactNode;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const short = reason.trim().length < 5;

  const close = () => {
    setReason('');
    setError(null);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={title}
      width={460}
      footer={
        <>
          <Button onClick={close}>Huỷ bỏ</Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            loading={busy}
            disabled={short}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm(reason.trim());
                close();
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Có lỗi xảy ra');
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
      <div className="flex flex-col gap-3">
        {description && <div className="text-[13px] text-muted">{description}</div>}
        {extra}
        <label className="flex flex-col gap-1.5 text-[13px] font-medium">
          Lý do (bắt buộc, lưu vào lịch sử sửa)
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="rounded-ctl border border-field px-3 py-2 text-sm font-normal focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15"
            placeholder="Ví dụ: nhân viên quên mật khẩu"
          />
          <span className="text-xs font-normal text-faint">Tối thiểu 5 ký tự</span>
        </label>
        <FormError message={error} />
      </div>
    </Dialog>
  );
}
