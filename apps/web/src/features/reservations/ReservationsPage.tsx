import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Phone,
  UserCheck,
  Users,
  XCircle,
} from 'lucide-react';
import type { ReservationDto } from '@ketoan/api/contracts';
import { PageHeader } from '@/components/PageHeader';
import { DateInput } from '@/components/DateInput';
import { Button } from '@/components/ui/Button';
import { Badge, Card, EmptyState, Segmented, Select } from '@/components/ui/controls';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { FormError } from '@/auth/AuthCard';
import { client, errorMessage, ok } from '@/lib/api-client';
import { useBusinessToday } from '@/lib/business-date';
import { dateVi, money, parseMoney } from '@/lib/format';
import { usePosMaybe } from '@/pos/context';
import { useFloor, useReservations } from '@/pos/data';

/** Shop clock (UTC+7) parts of an instant. */
const shop = (iso: string) => {
  const d = new Date(Date.parse(iso) + 7 * 3600_000).toISOString();
  return { date: d.slice(0, 10), time: d.slice(11, 16) };
};
const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const STATUS: Record<ReservationDto['status'], React.ReactNode> = {
  BOOKED: <Badge tone="primary">Chờ khách</Badge>,
  ARRIVED: <Badge tone="good">Đã đến</Badge>,
  CANCELLED: <Badge>Đã huỷ</Badge>,
  NO_SHOW: <Badge tone="bad">Không đến</Badge>,
};
const DEPOSIT_METHOD = { CASH: 'tiền mặt', TRANSFER: 'chuyển khoản' } as const;
const OUTCOME = { USED: 'đã trừ vào bill', REFUNDED: 'đã hoàn', KEPT: 'giữ lại' } as const;

/** Đặt bàn: bookings of one business day. Also a tab of the selling screen. */
export function ReservationsPage({ inPos = false }: { inPos?: boolean }) {
  const today = useBusinessToday();
  const [picked, setPicked] = useState<string | null>(null);
  const day = picked ?? today;
  const list = useReservations(day, day);
  const [editing, setEditing] = useState<ReservationDto | 'new' | null>(null);
  const [arriving, setArriving] = useState<ReservationDto | null>(null);
  const [cancelling, setCancelling] = useState<ReservationDto | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const rows = list.data ?? [];
  const waiting = rows.filter((r) => r.status === 'BOOKED');

  return (
    <div className={inPos ? 'h-full overflow-y-auto p-3' : ''}>
      <PageHeader
        title="Đặt bàn"
        subtitle={
          waiting.length
            ? `${waiting.length} bàn chờ khách · ${waiting.reduce((s, r) => s + r.guests, 0)} khách`
            : 'Ghi khách đặt trước; khách đến bấm "Khách đến" để mở đơn đúng bàn.'
        }
        actions={
          <Button variant="primary" icon={<CalendarPlus size={16} />} onClick={() => setEditing('new')}>
            Đặt bàn mới
          </Button>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <Button
            size="sm"
            icon={<ChevronLeft size={16} />}
            aria-label="Ngày trước"
            onClick={() => setPicked(addDays(day, -1))}
          />
          <div className="w-40">
            <DateInput aria-label="Ngày" value={day} onChange={(v) => v && setPicked(v)} />
          </div>
          <Button
            size="sm"
            icon={<ChevronRight size={16} />}
            aria-label="Ngày sau"
            onClick={() => setPicked(addDays(day, 1))}
          />
          {day !== today && (
            <Button size="sm" variant="ghost" onClick={() => setPicked(null)}>
              Hôm nay
            </Button>
          )}
        </div>
        {list.isLoading ? (
          <p className="px-4 py-6 text-[13px] text-muted">Đang tải…</p>
        ) : rows.length === 0 ? (
          <EmptyState
            title={`Không có đặt bàn ngày ${dateVi(day)}`}
            hint="Bấm “Đặt bàn mới” khi khách gọi điện đặt trước."
          />
        ) : (
          <ul className="divide-y divide-line-soft">
            {rows.map((r) => {
              const late = r.status === 'BOOKED' ? Math.floor((now - Date.parse(r.reservedAt)) / 60_000) : 0;
              const held = Number(r.deposit) > 0;
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                  <div className="w-14 shrink-0 text-center">
                    <div className="num text-lg font-bold text-ink-strong">{shop(r.reservedAt).time}</div>
                    {shop(r.reservedAt).date !== day && (
                      <div className="text-[11px] text-muted">
                        {dateVi(shop(r.reservedAt).date).slice(0, 5)}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <b className="text-ink-strong">{r.name}</b>
                      {STATUS[r.status]}
                      {late > 15 && <Badge tone="warn">Trễ {late}′</Badge>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-[13px] text-muted">
                      <span className="flex items-center gap-1">
                        <Users size={13} /> {r.guests} khách
                      </span>
                      <span>{r.tableName ?? 'Chưa xếp bàn'}</span>
                      {r.phone && (
                        <a href={`tel:${r.phone}`} className="num flex items-center gap-1 hover:underline">
                          <Phone size={13} /> {r.phone}
                        </a>
                      )}
                      {r.customerName && (
                        <span className="text-primary-ink">Khách quen: {r.customerName}</span>
                      )}
                      {held && (
                        <span className="text-good">
                          Cọc {money(r.deposit)} ({r.depositMethod ? DEPOSIT_METHOD[r.depositMethod] : ''}
                          {r.depositOutcome ? `, ${OUTCOME[r.depositOutcome]}` : ''})
                        </span>
                      )}
                      {r.orderCode && <span>Đơn {r.orderCode}</span>}
                    </div>
                    {(r.note || r.cancelReason) && (
                      <p className="mt-0.5 text-[13px]">
                        {r.cancelReason ? `Lý do: ${r.cancelReason}` : r.note}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {r.status === 'BOOKED' && (
                      <>
                        <Button
                          size="sm"
                          variant="primary"
                          icon={<UserCheck size={14} />}
                          onClick={() => setArriving(r)}
                        >
                          Khách đến
                        </Button>
                        <Button size="sm" icon={<Pencil size={14} />} onClick={() => setEditing(r)}>
                          Sửa
                        </Button>
                      </>
                    )}
                    {(r.status === 'BOOKED' || (r.status === 'ARRIVED' && held && !r.depositOutcome)) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<XCircle size={14} />}
                        onClick={() => setCancelling(r)}
                      >
                        {r.status === 'BOOKED' ? 'Huỷ' : 'Xử lý cọc'}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {editing && (
        <ReservationForm
          reservation={editing === 'new' ? null : editing}
          day={day}
          onClose={() => setEditing(null)}
          onSaved={(r) => (setEditing(null), setPicked(r.businessDate === today ? null : r.businessDate))}
        />
      )}
      {arriving && <ArriveDialog reservation={arriving} onClose={() => setArriving(null)} />}
      {cancelling && <CancelDialog reservation={cancelling} onClose={() => setCancelling(null)} />}
    </div>
  );
}

export const PosReservationsPage = () => <ReservationsPage inPos />;

function useTables() {
  const floor = useFloor();
  return useMemo(
    () =>
      (floor.data?.areas ?? []).flatMap((a) =>
        a.tables.map((t) => ({ id: t.id, name: t.name, area: a.name, seats: t.seats })),
      ),
    [floor.data],
  );
}

function ReservationForm({
  reservation,
  day,
  onClose,
  onSaved,
}: {
  reservation: ReservationDto | null;
  day: string;
  onClose: () => void;
  onSaved: (r: ReservationDto) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const tables = useTables();
  const at = reservation ? shop(reservation.reservedAt) : { date: day, time: '19:00' };
  const [name, setName] = useState(reservation?.name ?? '');
  const [phone, setPhone] = useState(reservation?.phone ?? '');
  const [guests, setGuests] = useState(String(reservation?.guests ?? 2));
  const [date, setDate] = useState(at.date);
  const [time, setTime] = useState(at.time);
  const [duration, setDuration] = useState(String(reservation?.durationMin ?? 120));
  const [tableId, setTableId] = useState<string>(reservation?.tableId ? String(reservation.tableId) : '');
  const [note, setNote] = useState(reservation?.note ?? '');
  const [deposit, setDeposit] = useState(
    reservation && Number(reservation.deposit) ? money(reservation.deposit) : '',
  );
  const [method, setMethod] = useState<'CASH' | 'TRANSFER'>(reservation?.depositMethod ?? 'CASH');

  const save = useMutation({
    mutationFn: async () => {
      const amount = parseMoney(deposit);
      const body = {
        name,
        phone: phone.trim() || null,
        guests: Number(guests) || 1,
        reservedAt: `${date}T${time}:00+07:00`,
        durationMin: Number(duration),
        tableId: tableId ? Number(tableId) : null,
        note: note.trim() || null,
        deposit: String(amount),
        depositMethod: amount > 0 ? method : null,
      };
      return reservation
        ? ok(await client.reservations.update({ params: { id: reservation.id }, body }))
        : ok(await client.reservations.create({ body }));
    },
    onSuccess: (r) => {
      toast(
        Number(r.deposit) > 0 && r.depositMethod === 'CASH'
          ? `Đã lưu đặt bàn — ghi thu ${money(r.deposit)} tiền cọc vào sổ quỹ`
          : 'Đã lưu đặt bàn',
      );
      qc.invalidateQueries({ queryKey: ['reservations'] });
      onSaved(r);
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={reservation ? `Sửa đặt bàn ${reservation.name}` : 'Đặt bàn mới'}
      width={560}
      footer={
        <>
          <Button onClick={onClose}>Huỷ bỏ</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!name.trim() || !time}
            onClick={() => save.mutate()}
          >
            Lưu
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tên khách">
          {(id) => <Input id={id} autoFocus value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label="Số điện thoại" hint="Trùng khách quen thì tự gắn (tích điểm)">
          {(id, d) => (
            <Input
              id={id}
              aria-describedby={d}
              inputMode="tel"
              className="num"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          )}
        </Field>
        <Field label="Ngày">{() => <DateInput aria-label="Ngày" value={date} onChange={setDate} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Giờ đến">
            {(id) => <Input id={id} type="time" value={time} onChange={(e) => setTime(e.target.value)} />}
          </Field>
          <Field label="Số khách">
            {(id) => (
              <Input
                id={id}
                inputMode="numeric"
                className="num text-right"
                value={guests}
                onChange={(e) => setGuests(e.target.value.replace(/\D/g, ''))}
              />
            )}
          </Field>
        </div>
        <Field label="Bàn">
          {(id) => (
            <Select id={id} value={tableId} onChange={(e) => setTableId(e.target.value)}>
              <option value="">Chưa xếp bàn</option>
              {tables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · {t.area} ({t.seats} chỗ)
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Giữ bàn trong">
          {(id) => (
            <Select id={id} value={duration} onChange={(e) => setDuration(e.target.value)}>
              {[60, 90, 120, 180, 240].map((m) => (
                <option key={m} value={m}>
                  {m % 60 ? `${Math.floor(m / 60)} giờ 30` : `${m / 60} giờ`}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="sm:col-span-2">
          <Field label="Ghi chú">
            {(id) => (
              <Input
                id={id}
                value={note}
                placeholder="VD: sinh nhật, cần ghế trẻ em"
                onChange={(e) => setNote(e.target.value)}
              />
            )}
          </Field>
        </div>
        <Field label="Tiền cọc (₫)" hint="Không cọc thì để trống">
          {(id, d) => (
            <Input
              id={id}
              aria-describedby={d}
              inputMode="numeric"
              className="num text-right"
              value={deposit}
              onChange={(e) => setDeposit(e.target.value)}
              onBlur={() => deposit && setDeposit(money(parseMoney(deposit)))}
            />
          )}
        </Field>
        {parseMoney(deposit) > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">Nhận cọc bằng</span>
            <Segmented
              label="Nhận cọc bằng"
              value={method}
              onChange={setMethod}
              options={[
                { value: 'CASH', label: 'Tiền mặt' },
                { value: 'TRANSFER', label: 'Chuyển khoản' },
              ]}
            />
            <span className="text-xs text-faint">
              {method === 'CASH'
                ? 'Tự ghi thu vào sổ quỹ hôm nay (tiền vào két).'
                : 'Không vào két; khi thanh toán là dòng Chuyển khoản.'}
            </span>
          </div>
        )}
        <div className="sm:col-span-2">
          <FormError message={save.error ? errorMessage(save.error) : null} />
        </div>
      </div>
    </Dialog>
  );
}

/** Guests arrived: open the order on the table (pick one if none was booked) and go to the menu. */
function ArriveDialog({ reservation: r, onClose }: { reservation: ReservationDto; onClose: () => void }) {
  const qc = useQueryClient();
  const pos = usePosMaybe();
  const navigate = useNavigate();
  const tables = useTables();
  const [tableId, setTableId] = useState(r.tableId ? String(r.tableId) : '');
  const open = useMutation({
    mutationFn: async () =>
      ok(
        await client.orders.open({
          body: {
            channel: 'DINE_IN',
            tableId: Number(tableId),
            deliveryAppId: null,
            appOrderCode: null,
            guestCount: r.guests,
            note: r.note ? `Đặt bàn: ${r.name} — ${r.note}` : `Đặt bàn: ${r.name}`,
            items: [],
            reservationId: r.id,
          },
        }),
      ),
    onSuccess: (o) => {
      qc.invalidateQueries({ queryKey: ['reservations'] });
      if (pos) pos.setTarget({ orderId: o.id });
      else
        try {
          sessionStorage.setItem('ketoan.pos.order', String(o.id));
        } catch {
          /* the menu screen then starts empty */
        }
      navigate('/pos/order');
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Khách đến · ${r.name}`}
      width={440}
      footer={
        <>
          <Button onClick={onClose}>Đóng</Button>
          <Button
            variant="primary"
            loading={open.isPending}
            disabled={!tableId}
            onClick={() => open.mutate()}
          >
            Mở đơn & gọi món
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px]">
        <p>
          {r.guests} khách
          {Number(r.deposit) > 0 && r.depositMethod
            ? ` · đã cọc ${money(r.deposit)} ${DEPOSIT_METHOD[r.depositMethod]} (trừ khi thanh toán)`
            : ''}
          {r.customerName ? ` · khách quen ${r.customerName}` : ''}
        </p>
        <Field label="Bàn">
          {(id) => (
            <Select id={id} value={tableId} onChange={(e) => setTableId(e.target.value)}>
              <option value="">Chọn bàn</option>
              {tables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · {t.area}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <FormError message={open.error ? errorMessage(open.error) : null} />
      </div>
    </Dialog>
  );
}

function CancelDialog({ reservation: r, onClose }: { reservation: ReservationDto; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<'CANCELLED' | 'NO_SHOW'>(
    r.status === 'ARRIVED' ? 'CANCELLED' : 'CANCELLED',
  );
  const [reason, setReason] = useState('');
  const [refund, setRefund] = useState(true);
  const held = Number(r.deposit) > 0 && !r.depositOutcome;
  const save = useMutation({
    mutationFn: async () =>
      ok(
        await client.reservations.cancel({
          params: { id: r.id },
          body: { status, reason, refund: held && refund },
        }),
      ),
    onSuccess: () => {
      toast(
        held && refund && r.depositMethod === 'CASH'
          ? `Đã ghi chi hoàn cọc ${money(r.deposit)} vào sổ quỹ`
          : 'Đã lưu',
      );
      qc.invalidateQueries({ queryKey: ['reservations'] });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={r.status === 'ARRIVED' ? `Tiền cọc của ${r.name}` : `Huỷ đặt bàn · ${r.name}`}
      width={460}
      footer={
        <>
          <Button onClick={onClose}>Đóng</Button>
          <Button
            variant="danger"
            loading={save.isPending}
            disabled={reason.trim().length < 5}
            onClick={() => save.mutate()}
          >
            Lưu
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-[13px]">
        {r.status === 'BOOKED' && (
          <Segmented
            label="Trạng thái"
            value={status}
            onChange={setStatus}
            options={[
              { value: 'CANCELLED', label: 'Khách huỷ' },
              { value: 'NO_SHOW', label: 'Khách không đến' },
            ]}
          />
        )}
        <Field label="Lý do">
          {(id) => <Input id={id} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        {held && r.depositMethod && (
          <div className="flex flex-col gap-1.5">
            <span className="font-medium">
              Tiền cọc {money(r.deposit)} ({DEPOSIT_METHOD[r.depositMethod]})
            </span>
            <Segmented
              label="Tiền cọc"
              value={refund ? 'REFUND' : 'KEEP'}
              onChange={(v) => setRefund(v === 'REFUND')}
              options={[
                { value: 'REFUND', label: 'Hoàn lại khách' },
                { value: 'KEEP', label: 'Giữ cọc' },
              ]}
            />
            <span className="text-xs text-faint">
              {refund
                ? r.depositMethod === 'CASH'
                  ? 'Lấy tiền từ két trả khách — tự ghi chi "Hoàn tiền cọc" vào sổ quỹ hôm nay.'
                  : 'Chuyển khoản lại cho khách từ tài khoản ngân hàng.'
                : 'Quán giữ tiền cọc (không tính vào doanh thu bán hàng).'}
            </span>
          </div>
        )}
        <FormError message={save.error ? errorMessage(save.error) : null} />
      </div>
    </Dialog>
  );
}
