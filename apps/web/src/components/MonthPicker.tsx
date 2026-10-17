import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { cn } from '@/lib/cn';
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
 * "‹ Tháng 10/2026 ›" — month stepper. The middle opens our own month grid (the browser's native month picker
 * cannot be styled and shows the month in its own words, "Tháng Mười Hai 2026", which overflowed the box).
 */
export function MonthPicker({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <div className="inline-flex h-9 items-center rounded-ctl border border-field bg-white shadow-[var(--shadow-btn)]">
      <button
        aria-label="Tháng trước"
        className="inline-flex h-full w-9 items-center justify-center text-muted hover:text-ink"
        onClick={() => onChange(shift(value, -1))}
      >
        <ChevronLeft size={16} />
      </button>
      <button
        ref={trigger}
        type="button"
        aria-label={`Chọn tháng, đang chọn ${monthLabel(value)}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex h-full w-[140px] items-center justify-center gap-1.5 rounded-md text-sm font-medium hover:bg-page',
          open && 'bg-primary-soft text-primary-ink',
        )}
      >
        <span className="num">{monthLabel(value)}</span>
        <CalendarDays size={15} className={open ? 'text-primary-ink' : 'text-faint'} aria-hidden />
      </button>
      <button
        aria-label="Tháng sau"
        className="inline-flex h-full w-9 items-center justify-center text-muted hover:text-ink"
        onClick={() => onChange(shift(value, 1))}
      >
        <ChevronRight size={16} />
      </button>
      {open && (
        <MonthGrid
          anchor={trigger}
          value={value}
          onPick={(m) => {
            onChange(m);
            setOpen(false);
            trigger.current?.focus();
          }}
          onClose={() => {
            setOpen(false);
            trigger.current?.focus();
          }}
        />
      )}
    </div>
  );
}

const MONTH_SHORT = Array.from({ length: 12 }, (_, i) => `Th${i + 1}`);

/** Popover: ‹ year › and a 4×3 grid of months. Fixed position so dialogs / cards never clip it. */
function MonthGrid({
  anchor,
  value,
  onPick,
  onClose,
}: {
  anchor: React.RefObject<HTMLButtonElement | null>;
  value: string;
  onPick: (m: string) => void;
  onClose: () => void;
}) {
  const [year, setYear] = useState(Number(value.slice(0, 4)));
  const [focusM, setFocusM] = useState(Number(value.slice(5)));
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const cells = useRef<(HTMLButtonElement | null)[]>([]);
  const current = thisMonth();

  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const w = 264;
      const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
      const below = window.innerHeight - r.bottom;
      setPos(
        below < 240 && r.top > below
          ? { position: 'fixed', left, width: w, bottom: window.innerHeight - r.top + 6 }
          : { position: 'fixed', left, width: w, top: r.bottom + 6 },
      );
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor]);

  useEffect(() => {
    if (pos) cells.current[focusM - 1]?.focus();
  }, [focusM, year, pos]);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [anchor, onClose]);

  const move = (delta: number) => {
    let m = focusM + delta;
    let y = year;
    if (m < 1) {
      m += 12;
      y -= 1;
    } else if (m > 12) {
      m -= 12;
      y += 1;
    }
    setYear(y);
    setFocusM(m);
  };

  return (
    <div
      ref={box}
      role="dialog"
      aria-label="Chọn tháng"
      style={pos ?? { position: 'fixed', visibility: 'hidden' }}
      className="z-50 rounded-card border border-line-soft bg-white p-3 shadow-[var(--shadow-pop)]"
      onKeyDown={(e) => {
        const keys: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -4, ArrowDown: 4 };
        if (e.key in keys) {
          e.preventDefault();
          move(keys[e.key]!);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation(); // close the grid, not a surrounding dialog
          onClose();
        } else if (e.key === 'PageUp' || e.key === 'PageDown') {
          e.preventDefault();
          setYear((y) => y + (e.key === 'PageUp' ? -1 : 1));
        }
      }}
    >
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          aria-label="Năm trước"
          onClick={() => setYear((y) => y - 1)}
          className="inline-flex size-8 items-center justify-center rounded-ctl text-muted hover:bg-page hover:text-ink"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="num text-sm font-semibold text-ink-strong">{year}</span>
        <button
          type="button"
          aria-label="Năm sau"
          onClick={() => setYear((y) => y + 1)}
          className="inline-flex size-8 items-center justify-center rounded-ctl text-muted hover:bg-page hover:text-ink"
        >
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {MONTH_SHORT.map((label, i) => {
          const m = `${year}-${String(i + 1).padStart(2, '0')}`;
          const selected = m === value;
          return (
            <button
              key={m}
              ref={(el) => {
                cells.current[i] = el;
              }}
              type="button"
              aria-pressed={selected}
              aria-label={monthLabel(m)}
              tabIndex={i + 1 === focusM ? 0 : -1}
              onClick={() => onPick(m)}
              onFocus={() => setFocusM(i + 1)}
              className={cn(
                'h-9 rounded-ctl text-[13px] font-medium transition-colors',
                selected
                  ? 'bg-primary text-white shadow-[var(--shadow-primary)]'
                  : 'text-ink hover:bg-primary-soft hover:text-primary-ink',
                !selected && m === current && 'ring-1 ring-inset ring-primary/50',
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between border-t border-line-soft pt-2">
        <button
          type="button"
          onClick={() => onPick(current)}
          className="rounded-md px-2 py-1 text-[13px] font-medium text-primary-ink hover:bg-primary-soft"
        >
          Tháng này
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-[13px] text-muted hover:bg-page"
        >
          Đóng
        </button>
      </div>
    </div>
  );
}
