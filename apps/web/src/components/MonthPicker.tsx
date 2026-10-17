import { useRef } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

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

/** "Tháng 12/2026" — short, the same in every browser and language. */
export const monthLabel = (month: string) => `Tháng ${Number(month.slice(5))}/${month.slice(0, 4)}`;

/**
 * "‹ Tháng 10/2026 ›" — month stepper. The middle shows our own short label; the browser's month picker
 * (an invisible native input over it) still opens on click. The native field's own text is not shown because
 * browsers render it in their language ("Tháng Mười Hai 2026"), which overflowed the box.
 */
export function MonthPicker({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="inline-flex h-9 items-center rounded-ctl border border-field bg-white shadow-[var(--shadow-btn)]">
      <button
        aria-label="Tháng trước"
        className="inline-flex h-full w-9 items-center justify-center text-muted hover:text-ink"
        onClick={() => onChange(shift(value, -1))}
      >
        <ChevronLeft size={16} />
      </button>
      <div className="relative inline-flex h-full w-[140px] items-center justify-center gap-1.5 rounded-md text-sm font-medium focus-within:ring-2 focus-within:ring-primary/30 hover:bg-page">
        <span className="num">{monthLabel(value)}</span>
        <CalendarDays size={15} className="text-faint" aria-hidden />
        <input
          ref={ref}
          type="month"
          aria-label="Chọn tháng"
          value={value}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          onClick={() => {
            try {
              ref.current?.showPicker?.();
            } catch {
              /* older browsers: the focused field still takes keyboard input */
            }
          }}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>
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
