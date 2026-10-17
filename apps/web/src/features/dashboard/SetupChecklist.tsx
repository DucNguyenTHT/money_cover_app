import { Link } from 'react-router';
import { CheckCircle2, Circle, ArrowRight } from 'lucide-react';
import type { Dashboard } from '@ketoan/api/contracts';
import { Card } from '@/components/ui/controls';
import { cn } from '@/lib/cn';

/** First-run guide for a new shop; disappears once every step is done. */
export function SetupChecklist({ setup }: { setup: Dashboard['setup'] }) {
  const steps = [
    {
      done: setup.shopNamed,
      label: 'Đặt tên quán, địa chỉ, VAT / phụ thu, tài khoản ngân hàng (VietQR)',
      to: '/admin/system/settings',
    },
    { done: setup.pinSet, label: 'Đặt mã PIN duyệt của ADMIN', to: '/admin/me' },
    { done: setup.staffAccounts, label: 'Tạo tài khoản thu ngân, bếp / bar', to: '/admin/system/users' },
    {
      done: setup.dishes,
      label: 'Nhập nguyên liệu và món (có thể nhập từ Excel)',
      to: '/admin/system/import',
    },
    {
      done: setup.recipes,
      label: 'Khai báo định mức để tự trừ kho và tính giá vốn',
      to: '/admin/system/import',
    },
    {
      done: setup.openingStock,
      label: 'Nhập tồn đầu (hoặc phiếu nhập đầu tiên)',
      to: '/admin/system/import',
    },
    {
      done: setup.printers,
      label: 'Cài máy in hoá đơn / bếp (không bắt buộc — có thể in qua trình duyệt)',
      to: '/admin/system/printers',
    },
  ];
  const left = steps.filter((s) => !s.done).length;
  if (!left) return null;
  return (
    <Card className="mb-4 p-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="font-semibold">Thiết lập ban đầu</h2>
        <span className="text-[13px] text-muted">
          Còn {left}/{steps.length} bước
        </span>
      </div>
      <ol className="flex flex-col gap-0.5">
        {steps.map((s) => (
          <li key={s.label}>
            <Link
              to={s.to}
              className={cn(
                'flex items-center gap-2.5 rounded-ctl px-2 py-1.5 text-[13px] hover:bg-page',
                s.done && 'text-muted line-through decoration-faint',
              )}
            >
              {s.done ? (
                <CheckCircle2 size={18} className="shrink-0 text-good" />
              ) : (
                <Circle size={18} className="shrink-0 text-faint" />
              )}
              <span className="flex-1">{s.label}</span>
              {!s.done && <ArrowRight size={14} className="text-primary-ink" />}
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}
