import type { ReactNode } from 'react';

/** Centered card used by the sign-in and first-login setup screens. */
export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-full items-center justify-center bg-page px-4 py-10">
      <div className="w-full max-w-[400px] rounded-card border border-line-soft bg-white p-7 shadow-[var(--shadow-card)]">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-ctl bg-primary text-lg font-bold text-white">
            Q
          </span>
          <div>
            <h1 className="text-lg font-bold text-ink-strong">{title}</h1>
            {subtitle && <p className="text-[13px] text-muted">{subtitle}</p>}
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-ctl bg-bad-soft px-3 py-2 text-[13px] text-bad-ink">
      {message}
    </p>
  );
}
