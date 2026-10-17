// Building blocks shared by report, dashboard and accounting pages.
import { useState, type ReactNode } from 'react';
import { ChevronDown, Download } from 'lucide-react';
import type { MonthStatus } from '@ketoan/api/domain';
import { Button } from './ui/Button';
import { Badge, Card } from './ui/controls';
import { Input } from './ui/Input';
import { useToast } from './ui/Toast';
import { money } from '@/lib/format';
import { cn } from '@/lib/cn';
import { exportCsv, exportXlsx, type ExportSheet } from '@/lib/export';
import { today } from './MonthPicker';

export const STATUS_META: Record<
  MonthStatus,
  { label: string; tone: 'good' | 'primary' | 'warn'; hint: string }
> = {
  CLOSED: { label: 'Đã chốt', tone: 'good', hint: 'Tháng đã khoá sổ — số liệu cố định' },
  PROVISIONAL: { label: 'Tạm tính', tone: 'primary', hint: 'Tháng đang mở, số liệu còn thay đổi' },
  NO_STOCKTAKE: { label: 'Chưa kiểm kê', tone: 'warn', hint: 'Lợi nhuận chưa trừ hao hụt kiểm kê' },
  MISSING_OVERHEAD: { label: 'Thiếu chi phí chung', tone: 'warn', hint: 'Chưa nhập chi phí chung của tháng' },
  PENDING_STOCK: { label: 'Còn nợ kho', tone: 'warn', hint: 'Giá vốn còn tạm vì bán khi chưa nhập hàng' },
};

export function StatusBadges({ statuses }: { statuses: MonthStatus[] }) {
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {statuses.map((s) => (
        <span key={s} title={STATUS_META[s].hint}>
          <Badge tone={STATUS_META[s].tone}>{STATUS_META[s].label}</Badge>
        </span>
      ))}
    </span>
  );
}

/** Money with a true minus and a "Lỗ" tag when negative (never colour alone). */
export function Signed({
  v,
  strong,
  lossTag = true,
}: {
  v: string | number;
  strong?: boolean;
  lossTag?: boolean;
}) {
  const n = Number(v);
  return (
    <span className={cn('num whitespace-nowrap', strong && 'font-semibold', n < 0 && 'text-bad')}>
      {money(n)}
      {n < 0 && lossTag && (
        <span className="ml-1 rounded bg-bad-soft px-1 text-[11px] font-semibold text-bad-ink">Lỗ</span>
      )}
    </span>
  );
}

export const pctText = (v: string | null) => (v === null ? '—' : `${v.replace('-', '−').replace('.', ',')}%`);

const iso = (d: Date) => d.toISOString().slice(0, 10);
export function monthBounds(month: string) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return { from: `${month}-01`, to: iso(new Date(Date.UTC(y, m, 0))) };
}
const shiftMonthStr = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return iso(new Date(Date.UTC(y, m - 1 + n, 1))).slice(0, 7);
};

export interface Range {
  from: string;
  to: string;
}
export const thisMonthRange = (): Range => ({ from: `${today().slice(0, 7)}-01`, to: today() });

/** From–to dates with quick presets. */
export function RangePicker({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const t = today();
  const m = t.slice(0, 7);
  const presets: [string, Range][] = [
    ['Hôm nay', { from: t, to: t }],
    ['7 ngày', { from: iso(new Date(Date.parse(t) - 6 * 86400_000)), to: t }],
    ['Tháng này', { from: `${m}-01`, to: t }],
    ['Tháng trước', monthBounds(shiftMonthStr(m, -1))],
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        type="date"
        aria-label="Từ ngày"
        value={value.from}
        max={value.to}
        onChange={(e) => onChange({ ...value, from: e.target.value })}
        className="h-9 w-40"
      />
      <span className="text-muted">–</span>
      <Input
        type="date"
        aria-label="Đến ngày"
        value={value.to}
        min={value.from}
        onChange={(e) => onChange({ ...value, to: e.target.value })}
        className="h-9 w-40"
      />
      <div className="flex flex-wrap gap-1">
        {presets.map(([label, r]) => (
          <button
            key={label}
            type="button"
            onClick={() => onChange(r)}
            className={cn(
              'h-8 rounded-full px-3 text-[13px]',
              r.from === value.from && r.to === value.to
                ? 'bg-primary-soft font-semibold text-primary-ink'
                : 'text-muted hover:bg-track',
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'bad' | 'good';
}) {
  return (
    <Card className="flex min-w-0 flex-col gap-1 p-4">
      <span className="text-[13px] text-muted">{label}</span>
      <span
        className={cn('num text-lg font-bold text-ink-strong sm:text-[22px]', tone === 'bad' && 'text-bad')}
      >
        {value}
      </span>
      {sub && <span className="text-xs text-muted">{sub}</span>}
    </Card>
  );
}

/** "Xuất ▾" → Excel (.xlsx) or CSV of the report table(s). */
export function ExportButton({
  filename,
  title,
  sheets,
}: {
  filename: string;
  title: string;
  sheets: () => ExportSheet[];
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <div className="relative">
      <Button
        icon={<Download size={18} />}
        loading={busy}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        Xuất <ChevronDown size={16} />
      </Button>
      {open && (
        <div
          className="absolute right-0 top-full z-20 mt-1 flex w-44 flex-col rounded-ctl border border-line bg-white py-1 shadow-[var(--shadow-pop)]"
          onMouseLeave={() => setOpen(false)}
        >
          <button
            className="px-3 py-2 text-left text-sm hover:bg-page"
            onClick={async () => {
              setOpen(false);
              setBusy(true);
              try {
                await exportXlsx(filename, title, sheets());
              } catch (e) {
                toast(e instanceof Error ? e.message : 'Lỗi xuất file', 'bad');
              } finally {
                setBusy(false);
              }
            }}
          >
            Excel (.xlsx)
          </button>
          <button
            className="px-3 py-2 text-left text-sm hover:bg-page"
            onClick={() => {
              setOpen(false);
              exportCsv(filename, sheets()[0]!);
            }}
          >
            CSV (bảng đầu tiên)
          </button>
        </div>
      )}
    </div>
  );
}

/** Simple dense table for reports (keeps numbers right-aligned, sticky header, optional total row). */
export function ReportTable({
  head,
  rows,
  total,
  align,
  minWidth = 640,
}: {
  head: string[];
  rows: ReactNode[][];
  total?: ReactNode[];
  align?: ('l' | 'r')[];
  minWidth?: number;
}) {
  const a = (i: number) => (align?.[i] ?? (i === 0 ? 'l' : 'r')) === 'r';
  return (
    <div tabIndex={0} role="region" aria-label="Bảng, cuộn ngang để xem thêm cột" className="overflow-x-auto">
      <table className="w-full text-sm" style={{ minWidth }}>
        <thead>
          <tr className="bg-primary-soft text-[13px] text-ink-strong">
            {head.map((h, i) => (
              <th
                key={i}
                className={cn(
                  'whitespace-nowrap px-4 py-2.5 font-semibold',
                  a(i) ? 'text-right' : 'text-left',
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, k) => (
            <tr key={k} className="border-b border-[#f2f4f7] hover:bg-[#f8fafd]">
              {r.map((c, i) => (
                <td
                  key={i}
                  className={cn('whitespace-nowrap px-4 py-2', a(i) ? 'num text-right' : 'text-left')}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
          {total && (
            <tr className="bg-total-row font-semibold">
              {total.map((c, i) => (
                <td key={i} className={cn('px-4 py-2.5', a(i) ? 'num text-right' : 'text-left')}>
                  {c}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
      {rows.length === 0 && (
        <p className="py-10 text-center text-[13px] text-muted">Không có dữ liệu trong khoảng này.</p>
      )}
    </div>
  );
}
