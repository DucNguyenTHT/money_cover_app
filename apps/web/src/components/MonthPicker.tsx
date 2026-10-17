import { ChevronLeft, ChevronRight } from 'lucide-react';

const shift = (month: string, delta: number) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
};

export const thisMonth = () => {
  const now = new Date(Date.now() + 7 * 3600_000);
  return now.toISOString().slice(0, 7);
};

export const today = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

/** "‹ Năm 2026 ›" — year stepper matching MonthPicker. */
export function YearPicker({ value, onChange }: { value: number; onChange: (y: number) => void }) {
  return (
    <div className="inline-flex h-9 items-center rounded-ctl border border-field bg-white shadow-[var(--shadow-btn)]">
      <button
        aria-label="Năm trước"
        className="inline-flex h-full w-9 items-center justify-center text-muted hover:text-ink"
        onClick={() => onChange(value - 1)}
      >
        <ChevronLeft size={16} />
      </button>
      <span className="w-[140px] text-center text-sm font-medium">Năm {value}</span>
      <button
        aria-label="Năm sau"
        className="inline-flex h-full w-9 items-center justify-center text-muted hover:text-ink"
        onClick={() => onChange(value + 1)}
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

/** "‹ Tháng 10/2026 ›" — month stepper with a native month input in the middle. */
export function MonthPicker({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  return (
    <div className="inline-flex h-9 items-center rounded-ctl border border-field bg-white shadow-[var(--shadow-btn)]">
      <button
        aria-label="Tháng trước"
        className="inline-flex h-full w-9 items-center justify-center text-muted hover:text-ink"
        onClick={() => onChange(shift(value, -1))}
      >
        <ChevronLeft size={16} />
      </button>
      <input
        type="month"
        aria-label="Chọn tháng"
        value={value}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        className="h-full w-[140px] bg-transparent text-center text-sm font-medium outline-none"
      />
      <button
        aria-label="Tháng sau"
        className="inline-flex h-full w-9 items-center justify-center text-muted hover:text-ink"
        onClick={() => onChange(shift(value, 1))}
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
