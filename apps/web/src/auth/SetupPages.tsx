import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { pinProblem } from '@ketoan/api/domain';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Input';
import { client, errorMessage, ok } from '@/lib/api-client';
import { AuthCard, FormError } from './AuthCard';
import { homeFor, useAuth } from './AuthProvider';

/** First login: replace the temporary password. */
export function SetupPasswordPage() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!user) return <Navigate to="/login" replace />;

  const mismatch = confirm.length > 0 && next !== confirm;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next.length < 8) return setError('Mật khẩu mới tối thiểu 8 ký tự');
    if (mismatch) return setError('Nhập lại mật khẩu chưa khớp');
    setBusy(true);
    setError(null);
    try {
      const u = ok(
        await client.auth.changePassword({ body: { currentPassword: current, newPassword: next } }),
      );
      setUser(u);
      navigate(homeFor(u), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Đổi mật khẩu" subtitle="Lần đầu đăng nhập — đặt mật khẩu của riêng bạn">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Mật khẩu hiện tại (tạm thời)">
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
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
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          )}
        </Field>
        <Field label="Nhập lại mật khẩu mới" error={mismatch ? 'Chưa khớp với mật khẩu mới' : undefined}>
          {(id, d) => (
            <Input
              id={id}
              aria-describedby={d}
              invalid={mismatch}
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          )}
        </Field>
        <FormError message={error} />
        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={busy}
          disabled={!current || !next || !confirm}
        >
          Lưu mật khẩu
        </Button>
      </form>
    </AuthCard>
  );
}

/** First login (ADMIN): set the approval PIN used on POS devices. */
export function SetupPinPage() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!user) return <Navigate to="/login" replace />;

  const pinError = pin.length >= 4 ? pinProblem(pin) : null;
  const mismatch = confirm.length > 0 && pin !== confirm;
  const onlyDigits = (v: string) => v.replace(/\D/g, '').slice(0, 6);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = pinProblem(pin) ?? (mismatch ? 'Nhập lại mã PIN chưa khớp' : null);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      const u = ok(await client.auth.setPin({ body: { currentPassword: password, pin } }));
      setUser(u);
      navigate(homeFor(u), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Đặt mã PIN duyệt" subtitle="Dùng để duyệt giảm giá, huỷ đơn ngay trên máy bán hàng">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Mật khẩu của bạn">
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Mã PIN"
          error={pinError ?? undefined}
          hint="4–6 chữ số, không dùng dãy dễ đoán như 1234, 0000"
        >
          {(id, d) => (
            <Input
              id={id}
              aria-describedby={d}
              invalid={!!pinError}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(e) => setPin(onlyDigits(e.target.value))}
              className="num tracking-[0.4em]"
            />
          )}
        </Field>
        <Field label="Nhập lại mã PIN" error={mismatch ? 'Chưa khớp' : undefined}>
          {(id, d) => (
            <Input
              id={id}
              aria-describedby={d}
              invalid={mismatch}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={confirm}
              onChange={(e) => setConfirm(onlyDigits(e.target.value))}
              className="num tracking-[0.4em]"
            />
          )}
        </Field>
        <FormError message={error} />
        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={busy}
          disabled={!password || pin.length < 4 || !confirm}
        >
          Lưu mã PIN
        </Button>
      </form>
    </AuthCard>
  );
}
