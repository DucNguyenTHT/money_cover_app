import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Modal built on the native <dialog> (focus trap + Esc for free).
 * On phones it becomes a full-width sheet; footer stays visible.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  width = 520,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      style={{ ['--w' as string]: `${width}px` }}
      className={cn(
        'm-0 mt-auto w-full max-w-none rounded-t-[16px] bg-white p-0 text-ink shadow-[var(--shadow-pop)] backdrop:bg-ink/30',
        'sm:m-auto sm:w-[min(var(--w),calc(100vw-32px))] sm:rounded-card',
      )}
    >
      {open && (
        <div className="flex max-h-[90dvh] flex-col">
          <div className="flex items-center justify-between border-b border-line-soft px-5 py-3.5">
            <h2 id={titleId} className="text-base font-semibold text-ink-strong">
              {title}
            </h2>
            <button
              onClick={onClose}
              aria-label="Đóng"
              className="inline-flex size-9 items-center justify-center rounded-ctl text-muted hover:bg-track"
            >
              <X size={18} />
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && (
            <div className="flex justify-end gap-2 border-t border-line-soft px-5 py-3">{footer}</div>
          )}
        </div>
      )}
    </dialog>
  );
}
