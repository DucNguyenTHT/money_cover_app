import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock } from 'lucide-react';
import { FormError } from '@/auth/AuthCard';
import { client, errorMessage, ok } from '@/lib/api-client';
import { dateVi } from '@/lib/format';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';

const KEY = ['attendance', 'me'];

/** "Vào ca / Ra ca" for a login linked to an employee (hidden otherwise). */
export function ClockInButton() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const me = useQuery({
    queryKey: KEY,
    queryFn: async () => ok(await client.staff.myAttendance()),
    staleTime: 60_000,
  });
  const clock = useMutation({
    mutationFn: async (action: 'IN' | 'OUT') => ok(await client.staff.clock({ body: { action } })),
    onSuccess: (next) => {
      qc.setQueryData(KEY, next);
      setOpen(false);
    },
  });
  const d = me.data;
  if (!d?.employee) return null;
  const r = d.row;
  const state = !r?.checkIn ? 'OUT' : r.checkOut ? 'DONE' : 'IN';
  const label = state === 'IN' ? `Vào ca ${r!.checkIn}` : state === 'DONE' ? 'Đã ra ca' : 'Chưa vào ca';

  return (
    <>
      <button
        type="button"
        aria-label={`Chấm công: ${label}`}
        title={`Chấm công: ${label}`}
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center gap-1.5 rounded-ctl px-2 hover:bg-white/60"
      >
        <Clock size={18} className={state === 'IN' ? 'text-good' : undefined} />
        <span className="hidden text-[13px] xl:inline">{label}</span>
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Chấm công · ${dateVi(d.today)}`}
        width={380}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Đóng</Button>
            {state !== 'DONE' && (
              <Button
                variant="primary"
                loading={clock.isPending}
                onClick={() => clock.mutate(state === 'OUT' ? 'IN' : 'OUT')}
              >
                {state === 'OUT' ? 'Vào ca' : 'Ra ca'}
              </Button>
            )}
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          <p className="font-semibold text-ink-strong">{d.employee.name}</p>
          {d.shift && (
            <p className="text-muted">
              Ca hôm nay: {d.shift.name} ({d.shift.start}–{d.shift.end})
            </p>
          )}
          <dl className="grid grid-cols-2 gap-2">
            <div className="rounded-ctl bg-page px-3 py-2">
              <dt className="text-xs text-muted">Vào ca</dt>
              <dd className="num text-lg font-bold">{r?.checkIn ?? '—'}</dd>
            </div>
            <div className="rounded-ctl bg-page px-3 py-2">
              <dt className="text-xs text-muted">Ra ca</dt>
              <dd className="num text-lg font-bold">{r?.checkOut ?? '—'}</dd>
            </div>
          </dl>
          {state === 'DONE' && (
            <p className="text-muted">Hôm nay đã chấm đủ vào / ra. Sửa giờ: nhờ chủ quán.</p>
          )}
          <FormError message={clock.error ? errorMessage(clock.error) : null} />
        </div>
      </Dialog>
    </>
  );
}
