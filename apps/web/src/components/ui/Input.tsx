import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }
>(function Input({ className, invalid, ...rest }, ref) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'h-10 w-full rounded-ctl border border-field bg-white px-3 text-sm text-ink placeholder:text-faint',
        'focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15',
        'read-only:bg-page read-only:text-muted',
        invalid && 'border-bad focus:border-bad focus:ring-bad/15',
        className,
      )}
      {...rest}
    />
  );
});

/** Label + control + error/hint, wired for accessibility. */
export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: (id: string, describedBy?: string) => ReactNode;
}) {
  const id = useId();
  const msgId = `${id}-msg`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium text-ink">
        {label}
      </label>
      {children(id, error || hint ? msgId : undefined)}
      {(error || hint) && (
        <p id={msgId} className={cn('text-xs', error ? 'text-bad' : 'text-faint')}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}
