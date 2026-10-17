import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Input';
import { errorMessage } from '@/lib/api-client';
import { AuthCard, FormError } from './AuthCard';
import { homeFor, useAuth } from './AuthProvider';

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={homeFor(user)} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await login(username.trim(), password);
      navigate(homeFor(u), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Đăng nhập" subtitle="Bán hàng & kế toán quán ăn">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Tên đăng nhập">
          {(id) => (
            <Input
              id={id}
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          )}
        </Field>
        <Field label="Mật khẩu">
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
        <FormError message={error} />
        <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!username || !password}>
          Đăng nhập
        </Button>
      </form>
    </AuthCard>
  );
}
