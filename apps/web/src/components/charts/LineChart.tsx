import { useState } from 'react';

export interface LinePoint {
  label: string;
  value: number;
}

const niceMax = (v: number) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
};

/**
 * Single-series line (2px) with a 10% wash, recessive grid, baseline at 0 and a hover crosshair + tooltip.
 * Text uses ink tokens, never the series color.
 */
export function LineChart({
  points,
  height = 220,
  format = (v) => String(v),
  ariaLabel,
}: {
  points: LinePoint[];
  height?: number;
  format?: (v: number) => string;
  ariaLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length === 0) return null;
  const max = niceMax(Math.max(...points.map((p) => p.value)));
  const ticks = [max, (max * 3) / 4, max / 2, max / 4, 0];
  const n = points.length;
  const x = (i: number) => (n === 1 ? 150 : (i / (n - 1)) * 300);
  const y = (v: number) => 100 - (v / max) * 100;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(p.value).toFixed(2)}`).join(' ');
  const area = `${path} L${x(n - 1).toFixed(2)},100 L${x(0).toFixed(2)},100 Z`;
  const pct = (i: number) => `${(x(i) / 3).toFixed(2)}%`;
  const h = hover === null ? null : points[hover]!;

  return (
    <div className="flex gap-2.5">
      <div className="relative w-16 shrink-0 text-right text-[11px] text-faint num" style={{ height }}>
        {ticks.map((t) => (
          <span
            key={t}
            className="absolute right-0 -translate-y-1/2"
            style={{ top: `${100 - (t / max) * 100}%` }}
          >
            {format(t)}
          </span>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative" style={{ height }} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <div
              key={t}
              className="absolute inset-x-0 h-px"
              style={{ top: `${100 - (t / max) * 100}%`, background: t === 0 ? '#dce2ea' : '#eef1f5' }}
            />
          ))}
          <svg
            role="img"
            aria-label={ariaLabel}
            viewBox="0 0 300 100"
            preserveAspectRatio="none"
            className="absolute inset-0 size-full overflow-visible"
          >
            <path d={area} fill="rgb(42 120 214 / 0.10)" />
            <path
              d={path}
              fill="none"
              stroke="#2a78d6"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {points.map((p, i) => (
            <span
              key={i}
              className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#2a78d6] ring-2 ring-white"
              style={{ left: pct(i), top: `${y(p.value)}%` }}
            />
          ))}
          {h && hover !== null && (
            <>
              <div className="absolute inset-y-0 w-px bg-[#c3cad6]" style={{ left: pct(hover) }} />
              <div
                className="pointer-events-none absolute top-1.5 z-10 whitespace-nowrap rounded-ctl border border-[#e3e8ef] bg-white px-3 py-2 text-xs shadow-[var(--shadow-pop)]"
                style={{
                  left: pct(hover),
                  transform: hover > n / 2 ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)',
                }}
              >
                <div className="font-semibold text-ink-strong">{h.label}</div>
                <div className="text-muted num">{format(h.value)}</div>
              </div>
            </>
          )}
          <div className="absolute inset-0 flex">
            {points.map((_, i) => (
              <div key={i} className="h-full flex-1" onMouseEnter={() => setHover(i)} />
            ))}
          </div>
        </div>
        <div className="mt-1.5 flex justify-between text-[11px] text-faint">
          <span>{points[0]!.label}</span>
          {n > 1 && <span>{points[n - 1]!.label}</span>}
        </div>
      </div>
    </div>
  );
}
