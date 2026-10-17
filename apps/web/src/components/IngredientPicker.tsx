import { useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import type { IngredientDto } from '@ketoan/api/contracts';
import { client, ok } from '@/lib/api-client';
import { cn } from '@/lib/cn';

export function useIngredients() {
  return useQuery({
    queryKey: ['ingredients'],
    queryFn: async () => ok(await client.catalog.listIngredients({ query: {} })),
    staleTime: 60_000,
  });
}

/** Searchable ingredient chooser (type name or code, ↑ ↓ Enter). */
export function IngredientPicker({
  value,
  onChange,
  invalid,
  placeholder = 'Tìm nguyên liệu…',
}: {
  value: number | null;
  onChange: (ing: IngredientDto) => void;
  invalid?: boolean;
  placeholder?: string;
}) {
  const { data } = useIngredients();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = data?.find((i) => i.id === value);
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties | null>(null);

  // The list is position: fixed (measured from the input) so table / dialog containers with
  // overflow hidden or scroll never clip it; it opens upwards when there is no room below.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = boxRef.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom;
      const up = below < 220 && r.top > below;
      setPos({
        position: 'fixed',
        left: r.left,
        width: Math.max(r.width, 240),
        maxHeight: Math.min(256, (up ? r.top : below) - 12),
        ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  const matches = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data ?? [])
      .filter(
        (i) =>
          i.active && (!term || i.name.toLowerCase().includes(term) || i.code.toLowerCase().includes(term)),
      )
      .slice(0, 30);
  }, [data, q]);

  const pick = (i: IngredientDto) => {
    onChange(i);
    setQ('');
    setOpen(false);
  };

  return (
    <div className="relative">
      <div
        ref={boxRef}
        className={cn(
          'flex h-10 items-center gap-2 rounded-ctl border bg-white px-2.5',
          invalid ? 'border-bad' : 'border-field',
          open && 'border-primary ring-4 ring-primary/15',
        )}
      >
        <Search size={15} className="shrink-0 text-faint" />
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          value={open ? q : (selected?.name ?? '')}
          placeholder={selected ? selected.name : placeholder}
          onFocus={() => {
            setOpen(true);
            setHi(0);
          }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => {
            setQ(e.target.value);
            setHi(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHi((h) => Math.min(h + 1, matches.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHi((h) => Math.max(h - 1, 0));
            } else if (e.key === 'Enter' && open && matches[hi]) {
              e.preventDefault();
              pick(matches[hi]);
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
          className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-faint"
        />
      </div>
      {open && pos && (
        <ul
          id={listId}
          role="listbox"
          style={pos}
          className="z-50 overflow-auto rounded-card border border-line-soft bg-white p-1 shadow-[var(--shadow-pop)]"
        >
          {matches.length === 0 && <li className="px-3 py-2 text-[13px] text-muted">Không tìm thấy</li>}
          {matches.map((i, idx) => (
            <li
              key={i.id}
              role="option"
              aria-selected={idx === hi}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(i);
              }}
              onMouseEnter={() => setHi(idx)}
              className={cn(
                'flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm',
                idx === hi && 'bg-primary-soft',
              )}
            >
              <span>{i.name}</span>
              <span className="text-xs text-faint">
                {i.code} · {i.unit}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
