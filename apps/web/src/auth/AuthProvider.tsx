import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { UserDto } from '@ketoan/api/contracts';
import { client, ok, onUnauthorized, tokenStore } from '@/lib/api-client';

interface AuthState {
  user: UserDto | null;
  /** True until the stored token has been checked on startup. */
  loading: boolean;
  login: (username: string, password: string) => Promise<UserDto>;
  logout: () => void;
  setUser: (u: UserDto) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserDto | null>(null);
  const [loading, setLoading] = useState(() => tokenStore.get() !== null);

  const logout = useCallback(() => {
    tokenStore.set(null);
    setUser(null);
  }, []);

  useEffect(() => {
    if (!tokenStore.get()) return;
    client.auth
      .me()
      .then((r) => setUser(ok(r)))
      .catch(() => tokenStore.set(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const handler = () => logout();
    onUnauthorized.addEventListener('unauthorized', handler);
    return () => onUnauthorized.removeEventListener('unauthorized', handler);
  }, [logout]);

  const login = useCallback(async (username: string, password: string) => {
    const res = ok(await client.auth.login({ body: { username, password } }));
    tokenStore.set(res.token);
    setUser(res.user);
    return res.user;
  }, []);

  const value = useMemo(() => ({ user, loading, login, logout, setUser }), [user, loading, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** Where a user lands after signing in (or after finishing the first-login setup). */
export function homeFor(u: UserDto): string {
  if (u.mustChangePassword) return '/setup/password';
  if (u.role === 'ADMIN' && !u.hasPin) return '/setup/pin';
  if (u.role === 'KITCHEN') return '/kitchen';
  if (u.role === 'STAFF') return '/pos';
  return '/admin';
}
