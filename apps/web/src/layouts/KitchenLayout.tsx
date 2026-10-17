import { useEffect, useState } from 'react';
import { Link, Outlet, useNavigate } from 'react-router';
import { LogOut, ShoppingCart, WifiOff } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { useOnline } from '@/lib/socket';

export function KitchenLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const online = useOnline();
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex h-full flex-col bg-page text-[15px]">
      <header className="flex h-[52px] shrink-0 items-center gap-4 border-b border-nav-line bg-nav px-4 text-nav-ink">
        <span className="text-[17px] font-bold">Màn hình bếp / bar</span>
        <div className="flex-1" />
        <span className="num text-sm">
          {clock.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
        </span>
        <span className="hidden text-[13px] sm:inline">{user?.fullName}</span>
        {user?.role !== 'KITCHEN' && (
          <Link
            to="/pos"
            aria-label="Về bán hàng"
            title="Về bán hàng"
            className="inline-flex size-9 items-center justify-center rounded-ctl hover:bg-white/60"
          >
            <ShoppingCart size={18} />
          </Link>
        )}
        <button
          aria-label="Đăng xuất"
          title="Đăng xuất"
          onClick={() => {
            logout();
            navigate('/login');
          }}
          className="inline-flex size-9 items-center justify-center rounded-ctl hover:bg-white/60"
        >
          <LogOut size={18} />
        </button>
      </header>
      {!online && (
        <div
          role="alert"
          className="flex items-center justify-center gap-2 bg-bad-soft px-3 py-1.5 text-[13px] font-medium text-bad-ink"
        >
          <WifiOff size={16} /> Mất kết nối — món mới có thể chưa hiện, đang kết nối lại…
        </div>
      )}
      <div className="min-h-0 flex-1 p-2">
        <Outlet />
      </div>
    </div>
  );
}
