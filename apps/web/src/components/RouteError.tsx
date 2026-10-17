import { isRouteErrorResponse, useRouteError } from 'react-router';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from './ui/Button';

/** Shown instead of a crashed screen; the rest of the app (other areas) keeps working. */
export function RouteError() {
  const err = useRouteError();
  const message = isRouteErrorResponse(err)
    ? `${err.status} ${err.statusText}`
    : err instanceof Error
      ? err.message
      : String(err);
  // A new deploy renames lazy chunks; reloading picks up the new ones.
  const stale = /Failed to fetch dynamically imported module|Importing a module script failed/i.test(message);
  return (
    <div className="flex h-full items-center justify-center bg-page p-4">
      <div className="flex max-w-md flex-col items-center gap-3 rounded-card bg-white p-8 text-center shadow-[var(--shadow-card)]">
        <AlertTriangle size={28} className="text-warn" />
        <h1 className="text-base font-semibold text-ink-strong">
          {stale ? 'Ứng dụng vừa được cập nhật' : 'Màn hình này gặp lỗi'}
        </h1>
        <p className="text-[13px] text-muted">
          {stale
            ? 'Tải lại trang để dùng phiên bản mới.'
            : 'Dữ liệu đã lưu không bị ảnh hưởng. Thử tải lại trang; nếu vẫn lỗi, báo cho quản lý.'}
        </p>
        {!stale && (
          <code className="max-w-full break-words rounded bg-page px-2 py-1 text-xs text-muted">
            {message}
          </code>
        )}
        <div className="flex gap-2">
          <Button variant="primary" icon={<RotateCcw size={16} />} onClick={() => window.location.reload()}>
            Tải lại
          </Button>
          <Button onClick={() => window.location.assign('/')}>Về trang chính</Button>
        </div>
      </div>
    </div>
  );
}
