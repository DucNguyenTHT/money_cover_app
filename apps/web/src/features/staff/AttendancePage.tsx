import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, ChevronLeft, ChevronRight, Lock, Plus } from 'lucide-react';
import type { AttendanceDto, ShiftDto } from '@ketoan/api/contracts';
import { FormError } from '@/auth/AuthCard';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, Select } from '@/components/ui/controls';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { client, errorMessage, ok } from '@/lib/api-client';
import { useBusinessToday } from '@/lib/business-date';
import { cn } from '@/lib/cn';
import { dateVi } from '@/lib/format';

const DAY = 86_400_000;
const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
/** Monday of the week holding `iso`. */
const monday = (iso: string) => addDays(iso, -((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7));
const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const hours = (v: string | number) => `${String(Math.round(Number(v) * 100) / 100).replace('.', ',')}h`;

interface Cell {
  employeeId: number;
  name: string;
  date: string;
  row: AttendanceDto | null;
}

/** Lịch & chấm công: one week, a row per employee — scheduled shift and actual in / out times. */
export function AttendancePage() {
  const today = useBusinessToday();
  const [picked, setPicked] = useState<string | null>(null);
  const start = picked ?? monday(today);
  const end = addDays(start, 6);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const [cell, setCell] = useState<Cell | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const week = useQuery({
    queryKey: ['staff', 'attendance', start],
    queryFn: async () => ok(await client.staff.attendance({ query: { from: start, to: end } })),
  });
  const d = week.data;
  const fill = useMutation({
    mutationFn: async () => ok(await client.staff.fillAttendance({ body: { from: start, to: end } })),
    onSuccess: (r) => {
      toast(r.filled ? `Đã điền giờ cho ${r.filled} ca` : 'Không còn ca nào chưa chấm trong tuần');
      qc.invalidateQueries({ queryKey: ['staff'] });
    },
    onError: (e) => toast(errorMessage(e), 'bad'),
  });
  const closed = (date: string) => d?.closedMonths.includes(date.slice(0, 7)) ?? false;
  const shiftOf = (id: number | null) => d?.shifts.find((s) => s.id === id);

  return (
    <div>
      <PageHeader
        title="Lịch & chấm công"
        subtitle="Xếp ca cho từng người, ghi giờ vào / ra thực tế. Giờ công cộng vào bảng lương tháng."
        actions={
          <Button
            icon={<CalendarCheck size={16} />}
            loading={fill.isPending}
            onClick={() => fill.mutate()}
            title="Các ngày đã xếp ca mà chưa có giờ vào / ra sẽ được tính đủ ca"
          >
            Điền đủ ca cả tuần
          </Button>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <div className="inline-flex h-9 items-center rounded-ctl border border-field bg-white shadow-[var(--shadow-btn)]">
            <button
              aria-label="Tuần trước"
              className="inline-flex h-full w-9 items-center justify-center text-muted hover:text-ink"
              onClick={() => setPicked(addDays(start, -7))}
            >
              <ChevronLeft size={16} />
            </button>
            <span className="num w-[190px] text-center text-sm font-medium">
              {dateVi(start).slice(0, 5)} – {dateVi(end)}
            </span>
            <button
              aria-label="Tuần sau"
              className="inline-flex h-full w-9 items-center justify-center text-muted hover:text-ink"
              onClick={() => setPicked(addDays(start, 7))}
            >
              <ChevronRight size={16} />
            </button>
          </div>
          {start !== monday(today) && (
            <Button size="sm" variant="ghost" onClick={() => setPicked(null)}>
              Tuần này
            </Button>
          )}
          <span className="ml-auto text-[13px] text-muted">Bấm vào ô để xếp ca hoặc sửa giờ</span>
        </div>
        {d && d.employees.length === 0 ? (
          <EmptyState
            title="Chưa có nhân viên"
            hint="Thêm nhân viên và các ca làm trước khi xếp lịch."
            action={
              <Link
                to="/admin/staff/employees"
                className="text-[13px] font-medium text-primary-ink hover:underline"
              >
                Mở Nhân viên & ca làm
              </Link>
            }
          />
        ) : (
          <div
            tabIndex={0}
            role="region"
            aria-label="Bảng chấm công, cuộn ngang để xem cả tuần"
            className="overflow-x-auto"
          >
            <table className="w-full min-w-[860px] table-fixed border-collapse text-sm">
              <thead>
                <tr className="bg-primary-soft text-[13px] text-ink-strong">
                  <th className="sticky left-0 z-[1] w-44 bg-primary-soft px-3 py-2 text-left font-semibold">
                    Nhân viên
                  </th>
                  {days.map((day, i) => (
                    <th
                      key={day}
                      className={cn(
                        'px-2 py-2 text-center font-semibold',
                        day === today && 'text-primary-ink',
                      )}
                    >
                      {WEEKDAYS[i]} <span className="font-normal text-muted">{dateVi(day).slice(0, 5)}</span>
                      {closed(day) && (
                        <Lock size={11} className="ml-1 inline text-faint" aria-label="Đã chốt lương" />
                      )}
                    </th>
                  ))}
                  <th className="w-20 px-3 py-2 text-right font-semibold">Tổng</th>
                </tr>
              </thead>
              <tbody>
                {d?.employees.map((e) => {
                  const rows = d.rows.filter((r) => r.employeeId === e.id);
                  const total = rows.reduce((s, r) => s + Number(r.hours), 0);
                  return (
                    <tr key={e.id} className="border-b border-line-soft">
                      <td className="sticky left-0 z-[1] bg-white px-3 py-2">
                        <span className="block font-medium text-ink-strong">{e.name}</span>
                        {e.position && <span className="text-xs text-muted">{e.position}</span>}
                      </td>
                      {days.map((day) => {
                        const r = rows.find((x) => x.date === day) ?? null;
                        const s = shiftOf(r?.shiftId ?? null);
                        return (
                          <td key={day} className="p-1 align-top">
                            <button
                              type="button"
                              disabled={closed(day)}
                              onClick={() => setCell({ employeeId: e.id, name: e.name, date: day, row: r })}
                              aria-label={`${e.name} ${dateVi(day)}`}
                              className={cn(
                                'flex min-h-[54px] w-full flex-col items-center justify-center gap-0.5 rounded-ctl border px-1 py-1 text-xs',
                                r ? 'border-line bg-page' : 'border-dashed border-line text-faint',
                                !closed(day) && 'hover:border-primary',
                                day === today && 'border-primary/50',
                              )}
                            >
                              {!r && <Plus size={14} />}
                              {s && <span className="font-semibold text-primary-ink">{s.name}</span>}
                              {r && (r.checkIn || r.checkOut) && (
                                <span className="num text-ink">
                                  {r.checkIn ?? '…'}–{r.checkOut ?? '…'}
                                </span>
                              )}
                              {r && Number(r.hours) > 0 && (
                                <span className="num text-muted">{hours(r.hours)}</span>
                              )}
                              {r?.note && !s && !r.checkIn && <span className="text-muted">{r.note}</span>}
                            </button>
                          </td>
                        );
                      })}
                      <td className="num px-3 py-2 text-right font-semibold">{total ? hours(total) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {cell && d && <CellDialog cell={cell} shifts={d.shifts} onClose={() => setCell(null)} />}
    </div>
  );
}

function CellDialog({ cell, shifts, onClose }: { cell: Cell; shifts: ShiftDto[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [shiftId, setShiftId] = useState(cell.row?.shiftId ? String(cell.row.shiftId) : '');
  const [checkIn, setCheckIn] = useState(cell.row?.checkIn ?? '');
  const [checkOut, setCheckOut] = useState(cell.row?.checkOut ?? '');
  const [note, setNote] = useState(cell.row?.note ?? '');
  const shift = shifts.find((s) => String(s.id) === shiftId);
  const choices = shifts.filter((s) => s.active || String(s.id) === shiftId);
  const save = useMutation({
    mutationFn: async (clear: boolean) =>
      ok(
        await client.staff.saveAttendance({
          body: {
            employeeId: cell.employeeId,
            date: cell.date,
            shiftId: clear || !shiftId ? null : Number(shiftId),
            checkIn: clear ? null : checkIn.trim() || null,
            checkOut: clear ? null : checkOut.trim() || null,
            note: clear ? null : note.trim() || null,
          },
        }),
      ),
    onSuccess: (_, clear) => {
      toast(clear ? 'Đã xoá' : 'Đã lưu');
      qc.invalidateQueries({ queryKey: ['staff'] });
      onClose();
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={`${cell.name} · ${dateVi(cell.date)}`}
      width={440}
      footer={
        <>
          {cell.row && (
            <Button
              variant="danger"
              className="mr-auto"
              loading={save.isPending && save.variables}
              onClick={() => save.mutate(true)}
            >
              Xoá
            </Button>
          )}
          <Button onClick={onClose}>Huỷ bỏ</Button>
          <Button
            variant="primary"
            loading={save.isPending && !save.variables}
            onClick={() => save.mutate(false)}
          >
            Lưu
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Ca">
          {(id) => (
            <Select id={id} value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
              <option value="">Không xếp ca</option>
              {choices.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.start}–{s.end})
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
          <Field label="Giờ vào">
            {(id) => (
              <Input
                id={id}
                inputMode="numeric"
                className="num"
                placeholder="07:00"
                value={checkIn}
                onChange={(e) => setCheckIn(e.target.value)}
              />
            )}
          </Field>
          <Field label="Giờ ra">
            {(id) => (
              <Input
                id={id}
                inputMode="numeric"
                className="num"
                placeholder="15:00"
                value={checkOut}
                onChange={(e) => setCheckOut(e.target.value)}
              />
            )}
          </Field>
          <Button
            variant="tonal"
            disabled={!shift}
            onClick={() => {
              setCheckIn(shift!.start);
              setCheckOut(shift!.end);
            }}
          >
            Đủ ca
          </Button>
        </div>
        <p className="-mt-2 text-xs text-faint">Giờ ra trước giờ vào (ca qua đêm) được tính sang hôm sau.</p>
        <Field label="Ghi chú">
          {(id) => (
            <Input
              id={id}
              value={note}
              placeholder="Nghỉ phép, đổi ca…"
              onChange={(e) => setNote(e.target.value)}
            />
          )}
        </Field>
        <FormError message={save.error ? errorMessage(save.error) : null} />
      </div>
    </Dialog>
  );
}
