import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import type { EmployeeDto, ShiftDto } from '@ketoan/api/contracts';
import { FormError } from '@/auth/AuthCard';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge, Card, EmptyState, Segmented, Select, Switch } from '@/components/ui/controls';
import { DataTable } from '@/components/ui/DataTable';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { client, errorMessage, ok } from '@/lib/api-client';
import { money } from '@/lib/format';

export const payText = (e: Pick<EmployeeDto, 'payType' | 'rate'>) =>
  `${money(e.rate)} ₫/${e.payType === 'HOURLY' ? 'giờ' : 'tháng'}`;
const hoursText = (h: number) => `${String(h).replace('.', ',')} giờ`;

/** Nhân viên & ca làm: who works here, how they are paid, and the shift templates used in the schedule. */
export function EmployeesPage() {
  const [editing, setEditing] = useState<EmployeeDto | 'new' | null>(null);
  const [shift, setShift] = useState<ShiftDto | 'new' | null>(null);
  const people = useQuery({
    queryKey: ['staff', 'employees'],
    queryFn: async () => ok(await client.staff.employees()),
  });
  const shifts = useQuery({
    queryKey: ['staff', 'shifts'],
    queryFn: async () => ok(await client.staff.shifts()),
  });

  return (
    <div>
      <PageHeader
        title="Nhân viên & ca làm"
        subtitle="Cách trả lương của từng người và các ca mẫu để xếp lịch. Gắn tài khoản để nhân viên tự bấm vào / ra ca."
        actions={
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditing('new')}>
            Thêm nhân viên
          </Button>
        }
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <DataTable<EmployeeDto>
            rows={people.data}
            loading={people.isLoading}
            rowKey={(e) => e.id}
            onRowClick={setEditing}
            empty={
              <EmptyState
                title="Chưa có nhân viên"
                action={
                  <Button variant="tonal" icon={<Plus size={16} />} onClick={() => setEditing('new')}>
                    Thêm nhân viên
                  </Button>
                }
              />
            }
            columns={[
              {
                key: 'name',
                header: 'Nhân viên',
                cell: (e) => (
                  <span className="flex flex-col">
                    <span className="flex items-center gap-2 font-medium text-ink-strong">
                      {e.name}
                      {!e.active && <Badge>Đã nghỉ</Badge>}
                    </span>
                    {e.position && <span className="text-xs text-muted">{e.position}</span>}
                  </span>
                ),
              },
              { key: 'pay', header: 'Lương', cell: (e) => <span className="num">{payText(e)}</span> },
              { key: 'phone', header: 'Điện thoại', secondary: true, cell: (e) => e.phone ?? '—' },
              {
                key: 'user',
                header: 'Tài khoản',
                cell: (e) => e.userName ?? <span className="text-faint">Chưa gắn</span>,
              },
            ]}
          />
        </Card>
        <Card className="self-start">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="font-semibold">Ca làm</h2>
            <Button size="sm" variant="tonal" icon={<Plus size={15} />} onClick={() => setShift('new')}>
              Thêm ca
            </Button>
          </div>
          {shifts.data?.length ? (
            <ul>
              {shifts.data.map((s) => (
                <li key={s.id} className="border-b border-line-soft last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setShift(s)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-page"
                  >
                    <span className="flex items-center gap-2 font-medium">
                      {s.name}
                      {!s.active && <Badge>Không dùng</Badge>}
                    </span>
                    <span className="num text-[13px] text-muted">
                      {s.start}–{s.end} · {hoursText(s.hours)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-6 text-center text-[13px] text-muted">
              Chưa có ca nào — thêm ca sáng / chiều / tối để xếp lịch nhanh.
            </p>
          )}
        </Card>
      </div>
      {editing && (
        <EmployeeForm employee={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
      {shift && <ShiftForm shift={shift === 'new' ? null : shift} onClose={() => setShift(null)} />}
    </div>
  );
}

function EmployeeForm({ employee, onClose }: { employee: EmployeeDto | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const users = useQuery({ queryKey: ['users'], queryFn: async () => ok(await client.users.list()) });
  const [f, setF] = useState({
    name: employee?.name ?? '',
    phone: employee?.phone ?? '',
    position: employee?.position ?? '',
    payType: employee?.payType ?? ('HOURLY' as EmployeeDto['payType']),
    rate: employee ? String(Number(employee.rate)) : '',
    userId: employee?.userId ? String(employee.userId) : '',
    active: employee?.active ?? true,
  });
  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: f.name.trim(),
        phone: f.phone.trim() || null,
        position: f.position.trim() || null,
        payType: f.payType,
        rate: f.rate || '0',
        userId: f.userId ? Number(f.userId) : null,
        active: f.active,
      };
      return ok(
        employee
          ? await client.staff.updateEmployee({ params: { id: employee.id }, body })
          : await client.staff.createEmployee({ body }),
      );
    },
    onSuccess: () => {
      toast('Đã lưu nhân viên');
      qc.invalidateQueries({ queryKey: ['staff'] });
      onClose();
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={employee ? 'Sửa nhân viên' : 'Thêm nhân viên'}
      width={520}
      footer={
        <>
          <Button onClick={onClose}>Huỷ bỏ</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!f.name.trim()}
            onClick={() => save.mutate()}
          >
            Lưu
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tên nhân viên">
            {(id) => <Input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}
          </Field>
          <Field label="Vị trí">
            {(id) => (
              <Input
                id={id}
                value={f.position}
                placeholder="Phục vụ, bếp, thu ngân…"
                onChange={(e) => setF({ ...f, position: e.target.value })}
              />
            )}
          </Field>
        </div>
        <Field label="Điện thoại">
          {(id) => <Input id={id} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Trả lương</span>
          <div className="flex flex-wrap items-center gap-3">
            <Segmented
              label="Cách trả lương"
              value={f.payType}
              onChange={(payType) => setF({ ...f, payType })}
              options={[
                { value: 'HOURLY', label: 'Theo giờ' },
                { value: 'MONTHLY', label: 'Theo tháng' },
              ]}
            />
            <label className="flex items-center gap-2 text-[13px] text-muted">
              <Input
                aria-label={f.payType === 'HOURLY' ? 'Lương mỗi giờ' : 'Lương mỗi tháng'}
                inputMode="numeric"
                className="num h-9 w-36 text-right"
                value={f.rate ? money(f.rate) : ''}
                placeholder="0"
                onChange={(e) => setF({ ...f, rate: e.target.value.replace(/\D/g, '') })}
              />
              ₫/{f.payType === 'HOURLY' ? 'giờ' : 'tháng'}
            </label>
          </div>
          <p className="text-xs text-faint">
            {f.payType === 'HOURLY'
              ? 'Lương = số giờ chấm công trong tháng × lương giờ.'
              : 'Lương tháng cố định; thưởng / trừ thêm ở bảng lương.'}
          </p>
        </div>
        <Field
          label="Tài khoản đăng nhập"
          hint="Để nhân viên tự bấm vào ca / ra ca trên máy bán hàng hoặc màn bếp"
        >
          {(id, describedBy) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={f.userId}
              onChange={(e) => setF({ ...f, userId: e.target.value })}
            >
              <option value="">Không gắn</option>
              {users.data?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName} ({u.username})
                </option>
              ))}
            </Select>
          )}
        </Field>
        {employee && (
          <Switch
            checked={f.active}
            onChange={(active) => setF({ ...f, active })}
            label="Đang làm"
            description="Tắt khi nhân viên nghỉ: không hiện trong lịch và bảng lương tháng sau."
          />
        )}
        <FormError message={save.error ? errorMessage(save.error) : null} />
      </div>
    </Dialog>
  );
}

function ShiftForm({ shift, onClose }: { shift: ShiftDto | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({
    name: shift?.name ?? '',
    start: shift?.start ?? '',
    end: shift?.end ?? '',
    sort: shift?.sort ?? 0,
    active: shift?.active ?? true,
  });
  const save = useMutation({
    mutationFn: async () => {
      const body = { ...f, name: f.name.trim(), start: f.start.trim(), end: f.end.trim() };
      return ok(
        shift
          ? await client.staff.updateShift({ params: { id: shift.id }, body })
          : await client.staff.createShift({ body }),
      );
    },
    onSuccess: () => {
      toast('Đã lưu ca làm');
      qc.invalidateQueries({ queryKey: ['staff'] });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={shift ? 'Sửa ca làm' : 'Thêm ca làm'}
      width={420}
      footer={
        <>
          <Button onClick={onClose}>Huỷ bỏ</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!f.name.trim() || !f.start || !f.end}
            onClick={() => save.mutate()}
          >
            Lưu
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Tên ca">
          {(id) => (
            <Input
              id={id}
              value={f.name}
              placeholder="Ca sáng"
              onChange={(e) => setF({ ...f, name: e.target.value })}
            />
          )}
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Bắt đầu">
            {(id) => (
              <Input
                id={id}
                inputMode="numeric"
                className="num"
                placeholder="06:00"
                value={f.start}
                onChange={(e) => setF({ ...f, start: e.target.value })}
              />
            )}
          </Field>
          <Field label="Kết thúc">
            {(id) => (
              <Input
                id={id}
                inputMode="numeric"
                className="num"
                placeholder="14:00"
                value={f.end}
                onChange={(e) => setF({ ...f, end: e.target.value })}
              />
            )}
          </Field>
          <Field label="Thứ tự">
            {(id) => (
              <Input
                id={id}
                inputMode="numeric"
                className="num"
                value={String(f.sort)}
                onChange={(e) => setF({ ...f, sort: Number(e.target.value.replace(/\D/g, '')) || 0 })}
              />
            )}
          </Field>
        </div>
        <p className="text-xs text-faint">Ca qua nửa đêm (22:00–02:00) được tính sang sáng hôm sau.</p>
        {shift && (
          <Switch
            checked={f.active}
            onChange={(active) => setF({ ...f, active })}
            label="Đang dùng"
            description="Tắt để không gợi ý khi xếp lịch; lịch cũ vẫn giữ."
          />
        )}
        <FormError message={save.error ? errorMessage(save.error) : null} />
      </div>
    </Dialog>
  );
}
