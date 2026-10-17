import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Lock, LockOpen } from 'lucide-react';
import type { PeriodDto } from '@ketoan/api/contracts';
import { PageHeader } from '@/components/PageHeader';
import { thisMonth } from '@/components/MonthPicker';
import { ReasonDialog } from '@/components/ReasonDialog';
import { Signed, StatusBadges } from '@/components/report';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Card } from '@/components/ui/controls';
import { useToast } from '@/components/ui/Toast';
import { client, errorMessage, ok } from '@/lib/api-client';
import { money } from '@/lib/format';

export function PeriodsPage() {
  const [year, setYear] = useState(Number(thisMonth().slice(0, 4)));
  const [locking, setLocking] = useState<PeriodDto | null>(null);
  const [unlocking, setUnlocking] = useState<PeriodDto | null>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ['periods', year],
    queryFn: async () => ok(await client.reports.periods({ query: { year } })),
  });
  const months = q.data ?? [];
  const lastLocked = [...months].reverse().find((m) => m.locked)?.month;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['periods'] });
    qc.invalidateQueries({ queryKey: ['report'] });
  };

  return (
    <div>
      <PageHeader
        title="Khoá sổ tháng"
        subtitle="Khoá tháng = chốt số liệu lãi lỗ cố định; mọi chứng từ của tháng đã khoá không sửa được nữa"
      />
      <div className="mb-4 inline-flex h-9 items-center rounded-ctl border border-field bg-white">
        <button
          aria-label="Năm trước"
          className="inline-flex size-9 items-center justify-center text-muted"
          onClick={() => setYear(year - 1)}
        >
          <ChevronLeft size={16} />
        </button>
        <span className="w-16 text-center text-sm font-semibold">{year}</span>
        <button
          aria-label="Năm sau"
          className="inline-flex size-9 items-center justify-center text-muted"
          onClick={() => setYear(year + 1)}
        >
          <ChevronRight size={16} />
        </button>
      </div>
      <Card>
        <div className="divide-y divide-[#f2f4f7]">
          {months.map((m) => (
            <div
              key={m.month}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 md:grid-cols-[110px_minmax(0,1fr)_150px_150px_150px]"
            >
              <span className="font-semibold">Tháng {Number(m.month.slice(5))}</span>
              <span className="flex min-w-0 flex-col gap-1">
                {m.hasActivity ? (
                  <StatusBadges statuses={m.statuses} />
                ) : (
                  <span className="text-[13px] text-faint">Chưa có số liệu</span>
                )}
                {!m.locked && m.hasActivity && m.problems.length > 0 && (
                  <span className="text-xs text-warn">{m.problems.join(' · ')}</span>
                )}
                {m.locked && (
                  <span className="text-xs text-muted">
                    Khoá {new Date(m.lockedAt!).toLocaleDateString('vi-VN')} bởi {m.lockedByName}
                  </span>
                )}
              </span>
              <span className="num hidden text-right text-[13px] md:block">
                <span className="block text-xs text-muted">DT thuần</span>
                {money(m.netRevenue)}
              </span>
              <span className="num hidden text-right text-[13px] md:block">
                <span className="block text-xs text-muted">LN ròng</span>
                <Signed v={m.netProfit} />
              </span>
              <span className="text-right">
                {m.locked
                  ? m.month === lastLocked && (
                      <Button size="sm" icon={<LockOpen size={16} />} onClick={() => setUnlocking(m)}>
                        Mở khoá
                      </Button>
                    )
                  : m.hasActivity && (
                      <Button
                        size="sm"
                        variant="primary"
                        icon={<Lock size={16} />}
                        disabled={m.problems.length > 0}
                        onClick={() => setLocking(m)}
                      >
                        Khoá sổ
                      </Button>
                    )}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Dialog
        open={!!locking}
        onClose={() => setLocking(null)}
        title={`Khoá sổ tháng ${locking?.month.slice(5)}/${locking?.month.slice(0, 4)}`}
        width={460}
        footer={
          <>
            <Button onClick={() => setLocking(null)}>Đóng</Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={async () => {
                if (!locking) return;
                setBusy(true);
                try {
                  ok(await client.reports.lock({ params: { month: locking.month }, body: {} }));
                  toast(`Đã khoá sổ tháng ${locking.month}`);
                  setLocking(null);
                  refresh();
                } catch (e) {
                  toast(errorMessage(e), 'bad');
                } finally {
                  setBusy(false);
                }
              }}
            >
              Khoá sổ
            </Button>
          </>
        }
      >
        {locking && (
          <div className="flex flex-col gap-2 text-[13px]">
            <p>
              Lợi nhuận ròng sẽ được chốt: <Signed v={locking.netProfit} strong />
            </p>
            {locking.statuses.includes('NO_STOCKTAKE') && (
              <p className="text-warn">Tháng chưa kiểm kê — lợi nhuận chưa trừ hao hụt.</p>
            )}
            {locking.statuses.includes('MISSING_OVERHEAD') && (
              <p className="text-warn">Chưa nhập chi phí chung của tháng.</p>
            )}
            <p className="text-muted">
              Sau khi khoá, phiếu nhập / xuất, đơn hàng, kiểm kê, chi phí chung của tháng không sửa được. Muốn
              sửa phải mở khoá (có lý do, lưu lịch sử).
            </p>
          </div>
        )}
      </Dialog>
      <ReasonDialog
        open={!!unlocking}
        title={`Mở khoá tháng ${unlocking?.month.slice(5)}/${unlocking?.month.slice(0, 4)}`}
        description="Số liệu đã chốt sẽ bị xoá và tính lại khi khoá lần sau."
        confirmLabel="Mở khoá"
        danger
        onClose={() => setUnlocking(null)}
        onConfirm={async (reason) => {
          ok(await client.reports.unlock({ params: { month: unlocking!.month }, body: { reason } }));
          toast('Đã mở khoá');
          refresh();
        }}
      />
    </div>
  );
}
