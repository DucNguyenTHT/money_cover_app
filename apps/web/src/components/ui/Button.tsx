import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'tonal' | 'pay' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-white shadow-[var(--shadow-primary)] hover:bg-primary-hover',
  secondary: 'bg-white text-[#344054] border border-field shadow-[var(--shadow-btn)] hover:bg-[#f8fafc]',
  tonal: 'bg-primary-soft text-primary-ink hover:bg-primary-soft-2',
  pay: 'bg-pay text-white shadow-[0_2px_6px_rgb(43_130_89/0.25),inset_0_1px_0_rgb(255_255_255/0.18)] hover:bg-pay-hover',
  danger: 'bg-bad-soft text-bad-ink hover:bg-[#fbdcd8]',
  ghost: 'bg-transparent text-muted hover:bg-track',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-9 px-3.5 text-sm',
  lg: 'h-11 px-4 text-[15px]',
  xl: 'h-[52px] px-4 text-base rounded-[12px]',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  /** Keyboard shortcut hint shown as a small chip, e.g. "F9". */
  kbd?: string;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, kbd, loading, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-ctl font-semibold transition-colors [&_svg]:shrink-0',
        'disabled:cursor-not-allowed disabled:opacity-55',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
      {kbd && (
        <span
          className={cn(
            // Shortcut hints only matter with a keyboard: hidden on phones.
            'hidden rounded-md px-1.5 py-0.5 text-[11px] font-semibold sm:inline',
            variant === 'primary' || variant === 'pay' ? 'bg-white/20' : 'bg-primary-soft-2',
          )}
        >
          {kbd}
        </span>
      )}
    </button>
  );
});

/** Square icon-only button (40×40, hairline border). Always pass `label` — it becomes aria-label + tooltip. */
export function IconButton({
  label,
  children,
  className,
  size = 40,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: number }) {
  return (
    <button
      aria-label={label}
      title={label}
      style={{ width: size, height: size }}
      className={cn(
        'inline-flex items-center justify-center rounded-ctl border border-field bg-white text-muted shadow-[var(--shadow-btn)] hover:bg-[#f8fafc] disabled:opacity-55',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent',
        className,
      )}
    />
  );
}
