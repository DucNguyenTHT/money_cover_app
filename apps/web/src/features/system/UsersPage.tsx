import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { KeyRound, Pencil, Plus, ShieldOff } from 'lucide-react';
import type { UserDto } from '@ketoan/api/contracts';
import { PageHeader } from '@/components/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, Card, Select, Switch } from '@/components/ui/controls';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input } from '@/components/ui/Input';
import { ReasonDialog } from '@/components/ReasonDialog';
import { useToast } from '@/components/ui/Toast';
import { FormError } from '@/auth/AuthCard';
import { useAuth } from '@/auth/AuthProvider';
import { client, errorMessage, ok } from '@/lib/api-client';

const ROLE_LABEL = { ADMIN: 'Quản lý (ADMIN)', STAFF: 'Thu ngân / phục vụ', KITCHEN: 'Bếp / bar' } as const;

type FormValues = {
  username: string;
  password: string;
  fullName: string;
  role: UserDto['role'];
  station: '' | 'KITCHEN' | 'BAR';
  active: boolean;
};

export function UsersPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { user: me } = useAuth();
  const users = useQuery({ queryKey: ['users'], queryFn: async () => ok(await client.users.list()) });
  const [editing, setEditing] = useState<UserDto | 'new' | null>(null);
  const [resetPw, setResetPw] = useState<UserDto | null>(null);
  const [resetPin, setResetPin] = useState<UserDto | null>(null);
  const [newPw, setNewPw] = useState('');

  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] });

  const columns: Column<UserDto>[] = [
    {
      key: 'name',
      header: 'Họ tên',
      cell: (u) => (
        <span className="flex items-center gap-2">
          {u.fullName}
          {u.id === me?.id && <Badge tone="primary">Bạn</Badge>}
        </span>
      ),
    },
    {
      key: 'username',
      header: 'Tên đăng nhập',
      cell: (u) => <span className="text-muted">{u.username}</span>,
    },
    {
      key: 'role',
      header: 'Vai trò',
      cell: (u) => ROLE_LABEL[u.role] + (u.station ? ` · ${u.station === 'BAR' ? 'Bar' : 'Bếp'}` : ''),
    },
    {
      key: 'pin',
      header: 'Mã PIN',
      secondary: true,
      cell: (u) =>
        u.role !== 'ADMIN' ? (
          '—'
        ) : u.hasPin ? (
          <Badge tone="good">Đã đặt</Badge>
        ) : (
          <Badge tone="warn">Chưa đặt</Badge>
        ),
    },
    {
      key: 'status',
      header: 'Trạng thái',
      cell: (u) =>
        !u.active ? (
          <Badge>Đã khoá</Badge>
        ) : u.mustChangePassword ? (
          <Badge tone="warn">Chờ đổi mật khẩu</Badge>
        ) : (
          <Badge tone="good">Hoạt động</Badge>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Tài khoản"
        subtitle="Mỗi nhân viên một tài khoản để đơn hàng và lịch sử sửa ghi đúng người"
        actions={
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditing('new')}>
            Thêm tài khoản
          </Button>
        }
      />
      <Card>
        <DataTable
          rows={users.data}
          loading={users.isLoading}
          columns={columns}
          rowKey={(u) => u.id}
          onRowClick={(u) => setEditing(u)}
          actions={(u) => (
            <>
              <IconButton label="Sửa" size={34} onClick={() => setEditing(u)}>
                <Pencil size={16} />
              </IconButton>
              <IconButton label="Đặt lại mật khẩu" size={34} onClick={() => setResetPw(u)}>
                <KeyRound size={16} />
              </IconButton>
              {u.role === 'ADMIN' && u.hasPin && (
                <IconButton label="Đặt lại mã PIN" size={34} onClick={() => setResetPin(u)}>
                  <ShieldOff size={16} />
                </IconButton>
              )}
            </>
          )}
        />
      </Card>

      {editing && (
        <UserForm
          user={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}

      <ReasonDialog
        open={!!resetPw}
        title={`Đặt lại mật khẩu: ${resetPw?.fullName ?? ''}`}
        description="Người dùng sẽ phải đổi mật khẩu này ở lần đăng nhập tiếp theo."
        extra={
          <Field label="Mật khẩu tạm thời" hint="Tối thiểu 8 ký tự">
            {(id, d) => (
              <Input id={id} aria-describedby={d} value={newPw} onChange={(e) => setNewPw(e.target.value)} />
            )}
          </Field>
        }
        onClose={() => {
          setResetPw(null);
          setNewPw('');
        }}
        onConfirm={async (reason) => {
          ok(
            await client.users.resetPassword({
              params: { id: resetPw!.id },
              body: { newPassword: newPw, reason },
            }),
          );
          toast('Đã đặt lại mật khẩu');
          refresh();
        }}
      />
      <ReasonDialog
        open={!!resetPin}
        danger
        title={`Đặt lại mã PIN: ${resetPin?.fullName ?? ''}`}
        description="Mã PIN hiện tại sẽ hết hiệu lực ngay. Người này phải tự đặt PIN mới ở lần đăng nhập sau."
        confirmLabel="Đặt lại PIN"
        onClose={() => setResetPin(null)}
        onConfirm={async (reason) => {
          ok(await client.users.resetPin({ params: { id: resetPin!.id }, body: { reason } }));
          toast('Đã đặt lại mã PIN');
          refresh();
        }}
      />
    </div>
  );
}

function UserForm({
  user,
  onClose,
  onSaved,
}: {
  user: UserDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const isNew = user === null;
  const { register, handleSubmit, watch, setValue, formState } = useForm<FormValues>({
    defaultValues: {
      username: user?.username ?? '',
      password: '',
      fullName: user?.fullName ?? '',
      role: user?.role ?? 'STAFF',
      station: user?.station ?? '',
      active: user?.active ?? true,
    },
  });
  const role = watch('role');
  const active = watch('active');

  const save = useMutation({
    mutationFn: async (v: FormValues) => {
      const base = {
        fullName: v.fullName,
        role: v.role,
        station: v.role === 'KITCHEN' ? v.station || null : null,
        active: v.active,
      };
      return isNew
        ? ok(
            await client.users.create({
              body: { ...base, username: v.username.trim().toLowerCase(), password: v.password },
            }),
          )
        : ok(await client.users.update({ params: { id: user.id }, body: base }));
    },
    onSuccess: () => {
      toast(isNew ? 'Đã tạo tài khoản' : 'Đã lưu');
      onSaved();
      onClose();
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={isNew ? 'Thêm tài khoản' : `Sửa tài khoản: ${user.fullName}`}
      footer={
        <>
          <Button onClick={onClose}>Huỷ bỏ</Button>
          <Button variant="primary" loading={save.isPending} onClick={handleSubmit((v) => save.mutate(v))}>
            Lưu
          </Button>
        </>
      }
    >
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit((v) => save.mutate(v))}>
        <div className="sm:col-span-2">
          <Field label="Họ tên" error={formState.errors.fullName?.message}>
            {(id) => <Input id={id} {...register('fullName', { required: 'Nhập họ tên' })} />}
          </Field>
        </div>
        {isNew && (
          <>
            <Field label="Tên đăng nhập" hint="a-z, 0-9, . _ -">
              {(id, d) => (
                <Input
                  id={id}
                  aria-describedby={d}
                  autoComplete="off"
                  {...register('username', { required: true })}
                />
              )}
            </Field>
            <Field label="Mật khẩu tạm thời" hint="Tối thiểu 8 ký tự, đổi ở lần đăng nhập đầu">
              {(id, d) => (
                <Input
                  id={id}
                  aria-describedby={d}
                  autoComplete="new-password"
                  {...register('password', { required: true })}
                />
              )}
            </Field>
          </>
        )}
        <Field label="Vai trò">
          {(id) => (
            <Select id={id} {...register('role')}>
              <option value="STAFF">{ROLE_LABEL.STAFF}</option>
              <option value="KITCHEN">{ROLE_LABEL.KITCHEN}</option>
              <option value="ADMIN">{ROLE_LABEL.ADMIN}</option>
            </Select>
          )}
        </Field>
        {role === 'KITCHEN' && (
          <Field label="Trạm">
            {(id) => (
              <Select id={id} {...register('station')}>
                <option value="">— Chọn trạm —</option>
                <option value="KITCHEN">Bếp</option>
                <option value="BAR">Quầy bar</option>
              </Select>
            )}
          </Field>
        )}
        {!isNew && (
          <div className="sm:col-span-2">
            <Switch
              checked={active}
              onChange={(v) => setValue('active', v)}
              label="Đang hoạt động"
              description="Tắt để khoá tài khoản (không xoá, vẫn giữ lịch sử)"
            />
          </div>
        )}
        <div className="sm:col-span-2">
          <FormError message={save.error ? errorMessage(save.error) : null} />
        </div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
