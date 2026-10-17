import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import type { Role } from '@ketoan/api/domain';
import { homeFor, useAuth } from './AuthProvider';
import { Spinner } from '@/components/ui/Button';

/** Gate a route: must be signed in, finished first-login setup, and (optionally) have one of `roles`. */
export function RequireRole({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-primary-ink">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  const home = homeFor(user);
  if (home.startsWith('/setup')) return <Navigate to={home} replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={home} replace />;
  return <>{children}</>;
}
