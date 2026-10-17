import type { ReactNode } from 'react';

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-lg font-bold text-ink-strong">{title}</h1>
        {subtitle && <p className="text-[13px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Temporary stand-in for screens built in later steps of the plan. */
export function ComingSoon({ title, step }: { title: string; step: number }) {
  return (
    <div>
      <PageHeader title={title} />
      <div className="rounded-card border border-line-soft bg-white p-8 text-center text-muted shadow-[var(--shadow-card)]">
        Màn hình này sẽ được làm ở bước {step} của kế hoạch.
      </div>
    </div>
  );
}
