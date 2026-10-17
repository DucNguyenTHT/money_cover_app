import { useState, type FormEvent } from 'react';
import { pinProblem } from '@ketoan/api/domain';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge, Card } from '@/components/ui/controls';
import { Field, Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { client, errorMessage, ok } from '@/lib/api-client';
import { FormError } from './AuthCard';
import { useAuth } from './AuthProvider';

export function MyAccountPage() {
  const { user, setUser } = useAuth();
  const toast = useToast();

  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [pin, setPin] = useState({ password: '', pin: '', confirm: '' });
  const [pinErr, setPinErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<'pw' | 'pin' | null>(null);
  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 6);

  if (!user) return null;

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    if (pw.next !== pw.confirm) return setPwErr('Nhập lại mật khẩu chưa khớp');
    setBusy('pw');
    setPwErr(null);
    try {
      setUser(
        ok(await client.auth.changePassword({ body: { currentPassword: pw.current, newPassword: pw.next } })),
      );
      setPw({ current: '', next: '', confirm: '' });
      toast('Đã đổi mật khẩu');
    } catch (err) {
      setPwErr(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function savePin(e: FormEvent) {
    e.preventDefault();
    const problem = pinProblem(pin.pin) ?? (pin.pin !== pin.confirm ? 'Nhập lại mã PIN chưa khớp' : null);
    if (problem) return setPinErr(problem);
    setBusy('pin');
    setPinErr(null);
    try {
      setUser(ok(await client.auth.setPin({ body: { currentPassword: pin.password, pin: pin.pin } })));
      setPin({ password: '', pin: '', confirm: '' });
      toast('Đã lưu mã PIN');
    } catch (err) {
      setPinErr(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="max-w-3xl">
      <PageHeader title="Tài khoản của tôi" subtitle={`${user.fullName} · ${user.username}`} />
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-4 font-semibold text-ink-strong">Đổi mật khẩu</h2>
          <form onSubmit={changePassword} className="flex flex-col gap-3">
            <Field label="Mật khẩu hiện tại">
              {(id) => (
                <Input
                  id={id}
                  type="password"
                  autoComplete="current-password"
                  value={pw.current}
                  onChange={(e) => setPw({ ...pw, current: e.target.value })}
                />
              )}
            </Field>
            <Field label="Mật khẩu mới" hint="Tối thiểu 8 ký tự">
              {(id, d) => (
                <Input
                  id={id}
                  aria-describedby={d}
                  type="password"
                  autoComplete="new-password"
                  value={pw.next}
                  onChange={(e) => setPw({ ...pw, next: e.target.value })}
                />
              )}
            </Field>
            <Field label="Nhập lại mật khẩu mới">
              {(id) => (
                <Input
                  id={id}
                  type="password"
                  autoComplete="new-password"
                  value={pw.confirm}
                  onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
                />
              )}
            </Field>
            <FormError message={pwErr} />
            <Button
              type="submit"
              variant="primary"
              loading={busy === 'pw'}
              disabled={!pw.current || !pw.next}
            >
              Đổi mật khẩu
            </Button>
          </form>
        </Card>

        {user.role === 'ADMIN' && (
          <Card className="p-5">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="font-semibold text-ink-strong">Mã PIN duyệt</h2>
              {user.hasPin ? <Badge tone="good">Đã đặt</Badge> : <Badge tone="warn">Chưa đặt</Badge>}
            </div>
            <p className="mb-4 text-[13px] text-muted">
              Nhập trên máy bán hàng để duyệt giảm giá vượt mức, huỷ đơn ngày trước.
            </p>
            <form onSubmit={savePin} className="flex flex-col gap-3">
              <Field label="Mật khẩu của bạn">
                {(id) => (
                  <Input
                    id={id}
                    type="password"
                    autoComplete="current-password"
                    value={pin.password}
                    onChange={(e) => setPin({ ...pin, password: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Mã PIN mới" hint="4–6 chữ số, không dùng dãy dễ đoán">
                {(id, d) => (
                  <Input
                    id={id}
                    aria-describedby={d}
                    type="password"
                    inputMode="numeric"
                    className="num tracking-[0.4em]"
                    value={pin.pin}
                    onChange={(e) => setPin({ ...pin, pin: digits(e.target.value) })}
                  />
                )}
              </Field>
              <Field label="Nhập lại mã PIN">
                {(id) => (
                  <Input
                    id={id}
                    type="password"
                    inputMode="numeric"
                    className="num tracking-[0.4em]"
                    value={pin.confirm}
                    onChange={(e) => setPin({ ...pin, confirm: digits(e.target.value) })}
                  />
                )}
              </Field>
              <FormError message={pinErr} />
              <Button
                type="submit"
                variant="primary"
                loading={busy === 'pin'}
                disabled={!pin.password || pin.pin.length < 4}
              >
                {user.hasPin ? 'Đổi mã PIN' : 'Đặt mã PIN'}
              </Button>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}
