import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { today } from './MonthPicker';

const DOW = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const vi = (iso: string) => iso.split('-').reverse().join('/');
const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const addMonths = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
};

/**
 * Date field ("18/10/2026" + our own calendar), the same in every browser. Value is "YYYY-MM-DD".
 * Replaces <input type="date">, whose look and wording depend on the browser and its language.
 */
export function DateInput({
  value,
  onChange,
  min,
  max,
  disabled,
  className,
  id,
  'aria-label': ariaLabel,
  'aria-describedby': describedBy,
}: {
  value: string;
  onChange: (v: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <>
      <button
        ref={trigger}
        id={id}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel ? `${ariaLabel}: ${value ? vi(value) : 'chưa chọn'}` : undefined}
        aria-describedby={describedBy}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex h-10 w-full items-center justify-between gap-2 rounded-ctl border border-field bg-white px-3 text-left text-sm text-ink',
          'focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15',
          'disabled:bg-page disabled:text-muted',
          open && 'border-primary ring-4 ring-primary/15',
          className,
        )}
      >
        <span className="num">{value ? vi(value) : 'dd/mm/yyyy'}</span>
        <CalendarDays size={15} className="shrink-0 text-faint" aria-hidden />
      </button>
      {open && (
        <DayGrid
          anchor={trigger}
          value={value || today()}
          min={min}
          max={max}
          onPick={(d) => {
            onChange(d);
            close();
          }}
          onClose={close}
        />
      )}
    </>
  );
}

/** Popover month calendar, fixed position so dialogs and cards never clip it. */
function DayGrid({
  anchor,
  value,
  min,
  max,
  onPick,
  onClose,
}: {
  anchor: React.RefObject<HTMLButtonElement | null>;
  value: string;
  min?: string;
  max?: string;
  onPick: (d: string) => void;
  onClose: () => void;
}) {
  const [focus, setFocus] = useState(value);
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const cells = useRef(new Map<string, HTMLButtonElement>());
  const now = today();
  const allowed = (d: string) => (!min || d >= min) && (!max || d <= max);

  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const w = 288;
      const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
      const below = window.innerHeight - r.bottom;
      setPos(
        below < 340 && r.top > below
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
    if (pos) cells.current.get(focus)?.focus();
  }, [focus, pos]);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [anchor, onClose]);

  // Six weeks starting on the Monday on / before the 1st of the focused month.
  const first = `${focus.slice(0, 7)}-01`;
  const offset = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const start = addDays(first, -offset);
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));

  return (
    <div
      ref={box}
      role="dialog"
      aria-label="Chọn ngày"
      style={pos ?? { position: 'fixed', visibility: 'hidden' }}
      className="z-50 rounded-card border border-line-soft bg-white p-3 shadow-[var(--shadow-pop)]"
      onKeyDown={(e) => {
        const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
        if (e.key in step) {
          e.preventDefault();
          setFocus((f) => addDays(f, step[e.key]!));
        } else if (e.key === 'PageUp' || e.key === 'PageDown') {
          e.preventDefault();
          setFocus((f) => addMonths(f, e.key === 'PageUp' ? -1 : 1));
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation(); // close the calendar, not a surrounding dialog
          onClose();
        }
      }}
    >
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          aria-label="Tháng trước"
          onClick={() => setFocus((f) => addMonths(f, -1))}
          className="inline-flex size-8 items-center justify-center rounded-ctl text-muted hover:bg-page hover:text-ink"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="num text-sm font-semibold text-ink-strong">
          Tháng {Number(focus.slice(5, 7))}/{focus.slice(0, 4)}
        </span>
        <button
          type="button"
          aria-label="Tháng sau"
          onClick={() => setFocus((f) => addMonths(f, 1))}
          className="inline-flex size-8 items-center justify-center rounded-ctl text-muted hover:bg-page hover:text-ink"
        >
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center" role="grid">
        {DOW.map((d) => (
          <span key={d} className="pb-1 text-[11px] font-semibold text-muted">
            {d}
          </span>
        ))}
        {days.map((d) => {
          const inMonth = d.slice(0, 7) === focus.slice(0, 7);
          const selected = d === value;
          const ok = allowed(d);
          return (
            <button
              key={d}
              ref={(el) => {
                if (el) cells.current.set(d, el);
                else cells.current.delete(d);
              }}
              type="button"
              disabled={!ok}
              aria-pressed={selected}
              aria-label={vi(d)}
              tabIndex={d === focus ? 0 : -1}
              onClick={() => onPick(d)}
              onFocus={() => setFocus(d)}
              className={cn(
                'num h-8 rounded-ctl text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                selected
                  ? 'bg-primary font-semibold text-white'
                  : inMonth
                    ? 'text-ink hover:bg-primary-soft hover:text-primary-ink'
                    : 'text-faint hover:bg-page',
                !selected && d === now && 'ring-1 ring-inset ring-primary/50',
              )}
            >
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between border-t border-line-soft pt-2">
        <button
          type="button"
          disabled={!allowed(now)}
          onClick={() => onPick(now)}
          className="rounded-md px-2 py-1 text-[13px] font-medium text-primary-ink hover:bg-primary-soft disabled:opacity-40"
        >
          Hôm nay
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
