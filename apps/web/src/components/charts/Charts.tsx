import { useState } from 'react';
import { cn } from '@/lib/cn';

/** Validated categorical slots (dataviz palette, light mode). Red is reserved for losses. */
export const SERIES = { blue: '#2a78d6', orange: '#eb6834', gray: '#8b95a7' } as const;
const LOSS = '#d03b3b';

/** Round axis bounds that always include 0. */
function scale(values: number[]) {
  const hi = Math.max(0, ...values);
  const lo = Math.min(0, ...values);
  const span = hi - lo || 1;
  const raw = span / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * p).find((s) => s >= raw)!;
  const max = Math.ceil(hi / step) * step;
  const min = Math.floor(lo / step) * step;
  const ticks: number[] = [];
  for (let t = max; t >= min - step / 2; t -= step) ticks.push(Math.abs(t) < step / 1e6 ? 0 : t);
  return { min, max: max === min ? min + step : max, ticks };
}

/** "12tr", "850k" — short axis labels; full numbers live in tooltips and tables. */
export const compactVnd = (v: number) => {
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (a >= 1e9) return `${sign}${+(a / 1e9).toFixed(1)}tỷ`;
  if (a >= 1e6) return `${sign}${+(a / 1e6).toFixed(1)}tr`;
  if (a >= 1e3) return `${sign}${+(a / 1e3).toFixed(0)}k`;
  return `${sign}${a}`;
};

export interface Series {
  name: string;
  color: string;
  values: number[];
  kind: 'line' | 'column';
}

/**
 * Columns and/or 2px lines over the same x labels, on ONE value axis that always contains 0.
 * Negative columns turn red (loss) and hang below the zero line. Hover shows every series at that x.
 */
export function SeriesChart({
  labels,
  series,
  format,
  height = 240,
  ariaLabel,
  tickEvery = 1,
}: {
  labels: string[];
  series: Series[];
  format: (v: number) => string;
  height?: number;
  ariaLabel: string;
  /** Show every n-th x label (dense daily charts). */
  tickEvery?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const n = labels.length;
  if (!n) return null;
  const { min, max, ticks } = scale(series.flatMap((s) => s.values));
  const y = (v: number) => ((max - v) / (max - min)) * 100;
  const zero = y(0);
  const cols = series.filter((s) => s.kind === 'column');
  const lines = series.filter((s) => s.kind === 'line');
  const slot = 100 / n;
  const cx = (i: number) => (i + 0.5) * slot;
  const barW = Math.min(slot * 0.7, 9) / Math.max(1, cols.length);
  const anyLoss = cols.some((s) => s.values.some((v) => v < 0));

  return (
    <figure className="m-0">
      {(series.length > 1 || anyLoss) && (
        <figcaption className="mb-2 flex flex-wrap gap-4 text-xs text-muted">
          {series.map((s) => (
            <span key={s.name} className="flex items-center gap-1.5">
              {s.kind === 'line' ? (
                <span className="h-0.5 w-4 rounded" style={{ background: s.color }} />
              ) : (
                <span className="size-2.5 rounded-[3px]" style={{ background: s.color }} />
              )}
              {s.name}
            </span>
          ))}
          {anyLoss && (
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-[3px]" style={{ background: LOSS }} />
              Lỗ (dưới 0)
            </span>
          )}
        </figcaption>
      )}
      <div className="flex gap-2">
        <div className="num relative w-12 shrink-0 text-right text-[11px] text-faint" style={{ height }}>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${y(t)}%` }}>
              {compactVnd(t)}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative" style={{ height }} onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <div
                key={t}
                className="absolute inset-x-0 h-px"
                style={{ top: `${y(t)}%`, background: t === 0 ? '#c3cad6' : '#eef1f5' }}
              />
            ))}
            {hover !== null && (
              <div
                className="absolute inset-y-0 bg-[#f2f5f9]"
                style={{ left: `${hover * slot}%`, width: `${slot}%` }}
              />
            )}
            {cols.map((s, k) =>
              s.values.map((v, i) => {
                const top = Math.min(y(v), zero);
                const h = Math.abs(y(v) - zero);
                return (
                  <div
                    key={`${s.name}-${i}`}
                    className={v >= 0 ? 'absolute rounded-t-[4px]' : 'absolute rounded-b-[4px]'}
                    style={{
                      left: `calc(${cx(i)}% - ${(barW * cols.length) / 2}% + ${k * barW}% + 1px)`,
                      width: `calc(${barW}% - 2px)`,
                      top: `${top}%`,
                      height: `${h}%`,
                      background: v < 0 ? LOSS : s.color,
                    }}
                  />
                );
              }),
            )}
            <svg
              role="img"
              aria-label={ariaLabel}
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="pointer-events-none absolute inset-0 size-full overflow-visible"
            >
              {lines.map((s) => (
                <path
                  key={s.name}
                  d={s.values
                    .map((v, i) => `${i ? 'L' : 'M'}${cx(i).toFixed(3)},${y(v).toFixed(3)}`)
                    .join(' ')}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
            {lines.map((s) =>
              s.values.map((v, i) =>
                n <= 31 || i === n - 1 || i === hover ? (
                  <span
                    key={`${s.name}-d${i}`}
                    className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white"
                    style={{ left: `${cx(i)}%`, top: `${y(v)}%`, background: v < 0 ? LOSS : s.color }}
                  />
                ) : null,
              ),
            )}
            {hover !== null && (
              <div
                className="pointer-events-none absolute top-1 z-10 whitespace-nowrap rounded-ctl border border-[#e3e8ef] bg-white px-3 py-2 text-xs shadow-[var(--shadow-pop)]"
                style={{
                  left: `${cx(hover)}%`,
                  transform: hover > n / 2 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)',
                }}
              >
                <div className="mb-1 font-semibold text-ink-strong">{labels[hover]}</div>
                {series.map((s) => {
                  const v = s.values[hover] ?? 0;
                  return (
                    <div key={s.name} className="flex items-center gap-2 text-muted">
                      <span className="size-2 rounded-full" style={{ background: s.color }} />
                      <span>{s.name}</span>
                      <span className={cn('num ml-auto pl-3 font-semibold', v < 0 ? 'text-bad' : 'text-ink')}>
                        {format(v)}
                        {v < 0 && ' (Lỗ)'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            {/* Pointer-only hover strips; the same numbers are in the table next to every chart. */}
            <div className="absolute inset-0 flex" aria-hidden>
              {labels.map((_, i) => (
                <div key={i} className="h-full flex-1" onMouseEnter={() => setHover(i)} />
              ))}
            </div>
          </div>
          <div className="relative mt-1.5 h-4 text-[11px] text-faint">
            {labels.map((l, i) =>
              i % tickEvery === 0 || i === n - 1 ? (
                <span
                  key={i}
                  className="absolute -translate-x-1/2 whitespace-nowrap"
                  style={{ left: `${cx(i)}%` }}
                >
                  {l}
                </span>
              ) : null,
            )}
          </div>
        </div>
      </div>
    </figure>
  );
}

/**
 * Horizontal bars ≤ 18px with 4px rounded data ends. With negatives the bars diverge around a
 * zero line (profit right, loss left in red, labelled "Lỗ"). Values sit in their own column.
 */
export function DivergingBars({
  rows,
  format,
  color = SERIES.blue,
}: {
  rows: { label: string; value: number; hint?: string }[];
  format: (v: number) => string;
  color?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  const hasNeg = rows.some((r) => r.value < 0);
  const half = hasNeg ? 50 : 100;
  return (
    <div className="flex flex-col gap-1" onMouseLeave={() => setHover(null)}>
      {rows.map((r, i) => {
        const w = `${(Math.abs(r.value) / max) * half}%`;
        return (
          <div
            key={`${r.label}-${i}`}
            onMouseEnter={() => setHover(i)}
            className={cn(
              'grid grid-cols-[minmax(0,140px)_minmax(0,1fr)_100px] items-center gap-3 rounded px-1 py-0.5 text-[13px] sm:grid-cols-[minmax(0,200px)_minmax(0,1fr)_130px]',
              hover === i && 'bg-[#f2f5f9]',
            )}
            title={r.hint}
          >
            <span className="truncate">{r.label}</span>
            <span className="relative h-[18px]">
              {hasNeg && <span className="absolute inset-y-[-3px] left-1/2 w-px bg-[#c3cad6]" />}
              <span
                className={cn('absolute top-0 h-full', r.value >= 0 ? 'rounded-r-[4px]' : 'rounded-l-[4px]')}
                style={
                  r.value >= 0
                    ? { left: hasNeg ? '50%' : 0, width: w, background: color }
                    : { right: '50%', width: w, background: LOSS }
                }
              />
            </span>
            <span className={cn('num text-right font-semibold', r.value < 0 ? 'text-bad' : 'text-ink')}>
              {format(r.value)}
              {r.value < 0 && (
                <span className="ml-1 rounded bg-bad-soft px-1 text-[11px] text-bad-ink">Lỗ</span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
