import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  BadgeAlert,
  Ban,
  Bell,
  CalendarX,
  DatabaseBackup,
  Clock,
  KeyRound,
  Landmark,
  PackageX,
  TrendingDown,
  type LucideIcon,
} from 'lucide-react';
import type { Dashboard } from '@ketoan/api/contracts';
import { client, ok } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { money } from '@/lib/format';

export interface AlertItem {
  icon: LucideIcon;
  /** Count shown in bold before the text; omitted for one-off notices. */
  n?: number;
  text: string;
  to: string;
}

/** Things the owner should look at, from the dashboard figures (only non-zero ones). */
/** Household tax: the 1 tỷ threshold and the e-invoice duty that comes with it. */
function taxItems(d: Dashboard): AlertItem[] {
  if (!d.tax) return [];
  const ratio = Number(d.tax.revenueYtd) / Number(d.tax.threshold);
  if (ratio > 1 && !d.tax.einvoiceRegistered)
    return [
      {
        icon: Landmark,
        text: 'Doanh thu năm đã vượt 1 tỷ: phải nộp thuế GTGT + TNCN và dùng hoá đơn điện tử máy tính tiền',
        to: '/admin/reports/tax',
      },
    ];
  if (ratio >= 0.8 && ratio <= 1)
    return [
      {
        icon: Landmark,
        text: `Doanh thu năm đã đạt ${Math.floor(ratio * 100)}% ngưỡng chịu thuế 1 tỷ`,
        to: '/admin/reports/tax',
      },
    ];
  return [];
}

const BACKUP_TEXT: Record<NonNullable<Dashboard['alerts']['backup']>, string> = {
  NEVER: 'Chưa có bản sao lưu dữ liệu nào',
  FAILED: 'Lần sao lưu dữ liệu gần nhất bị lỗi',
  STALE: 'Đã hơn 2 ngày chưa có bản sao lưu dữ liệu mới',
  DRIVE_FAILED: 'Bản sao lưu chưa gửi được lên Google Drive',
};

export function alertItems(d: Dashboard): AlertItem[] {
  const monthProfit = Number(d.monthProfitAfterTax ?? d.monthNetProfit);
  return [
    ...(d.alerts.backup
      ? [{ icon: DatabaseBackup, text: BACKUP_TEXT[d.alerts.backup], to: '/admin/system/settings' }]
      : []),
    ...taxItems(d),
    ...(monthProfit < 0
      ? [
          {
            icon: TrendingDown,
            text: `Tháng ${Number(d.month.slice(5))} đang lỗ ${money(-monthProfit)} (tạm tính)`,
            to: '/admin/reports/pnl',
          },
        ]
      : []),
    {
      icon: TrendingDown,
      n: d.alerts.lossDishes,
      text: 'món đang lỗ theo định mức',
      to: '/admin/menu/price-alerts',
    },
    {
      icon: BadgeAlert,
      n: d.alerts.priceAlerts - d.alerts.lossDishes,
      text: 'món vượt % nguyên liệu mục tiêu',
      to: '/admin/menu/price-alerts',
    },
    {
      icon: PackageX,
      n: d.alerts.pendingIngredients,
      text: 'nguyên liệu đang nợ kho (bán khi chưa nhập)',
      to: '/admin/inventory/pending',
    },
    {
      icon: AlertTriangle,
      n: d.alerts.belowCostToday,
      text: 'đơn hôm nay bán dưới giá vốn',
      to: '/admin/reports/cancellations',
    },
    { icon: Ban, n: d.alerts.cancelledToday, text: 'đơn bị huỷ hôm nay', to: '/admin/reports/cancellations' },
    {
      icon: Clock,
      n: d.alerts.staleOpenOrders,
      text: 'đơn còn mở từ ngày trước — thanh toán hoặc huỷ để chốt được ngày đó',
      to: '/pos',
    },
    {
      icon: CalendarX,
      n: d.alerts.unclosedDays,
      text: 'ngày trong tháng chưa chốt tiền',
      to: '/admin/orders/day-closings',
    },
    {
      icon: KeyRound,
      n: d.alerts.lockedPins,
      text: 'mã PIN ADMIN đang bị khoá do nhập sai',
      to: '/admin/system/users',
    },
  ].filter((a) => a.n === undefined || a.n > 0);
}

export const useDashboard = (enabled = true) =>
  useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => ok(await client.reports.dashboard()),
    refetchInterval: 120_000,
    enabled,
  });

export function AlertList({ items, onPick }: { items: AlertItem[]; onPick?: () => void }) {
  if (!items.length) return <p className="px-2 py-1.5 text-[13px] text-good">Không có cảnh báo.</p>;
  return (
    <ul className="flex flex-col gap-1">
      {items.map((a) => (
        <li key={a.text}>
          <Link
            to={a.to}
            onClick={onPick}
            className="flex items-center gap-2.5 rounded-ctl px-2 py-1.5 text-[13px] text-ink hover:bg-page"
          >
            <a.icon size={16} className="shrink-0 text-warn" />
            <span>
              {a.n !== undefined && <b className="num">{a.n} </b>}
              {a.text}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Top-bar bell (ADMIN): badge with the number of alert kinds, dropdown with the list. */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const q = useDashboard();
  const items = q.data ? alertItems(q.data) : [];

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        aria-label={items.length ? `Thông báo: ${items.length} cảnh báo` : 'Thông báo'}
        title="Thông báo"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="relative inline-flex size-10 items-center justify-center rounded-ctl hover:bg-white/60"
      >
        <Bell size={18} />
        {items.length > 0 && (
          <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-bad px-1 text-[10px] font-bold text-white">
            {items.length}
          </span>
        )}
      </button>
      {open && (
        <div
          className={cn(
            'absolute right-0 top-full z-40 mt-1 w-80 rounded-card border border-line bg-white p-2 shadow-[var(--shadow-pop)]',
          )}
        >
          <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-faint">Cần chú ý</p>
          <AlertList items={items} onPick={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
