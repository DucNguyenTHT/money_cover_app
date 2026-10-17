import { useEffect, useRef } from 'react';
import { NavLink, Outlet, Link, useLocation, useNavigate } from 'react-router';
import {
  CalendarCheck,
  ChefHat,
  LayoutGrid,
  LogOut,
  ReceiptText,
  Settings2,
  UtensilsCrossed,
  WifiOff,
} from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { cn } from '@/lib/cn';
import { useOnline } from '@/lib/socket';
import { useToast } from '@/components/ui/Toast';
import { PosProvider, usePos } from '@/pos/context';
import { ApprovalProvider } from '@/pos/Approval';
import { usePosRealtime } from '@/pos/data';
import { SearchInput } from '@/components/ui/SearchInput';

/** Full-screen selling layout: tabs + dish search, no sidebar. */
export function PosLayout() {
  return (
    <PosProvider>
      <ApprovalProvider>
        <PosShell />
      </ApprovalProvider>
    </PosProvider>
  );
}

function PosShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { search, setSearch } = usePos();
  const online = useOnline();
  const searchRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  // Any till may trigger a print (e.g. a kitchen ticket); every till hears when a printer fails.
  usePosRealtime((message) => toast(message, 'bad'));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F3') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const tab = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex h-11 shrink-0 items-center gap-2 rounded-t-[12px] px-3 text-sm font-medium sm:px-4',
      isActive ? 'bg-page font-semibold text-primary-ink' : 'text-nav-ink hover:bg-white/50',
    );

  return (
    <div className="flex h-full flex-col bg-page text-[15px]">
      <header className="flex h-[52px] shrink-0 items-end gap-1 border-b border-nav-line bg-nav px-2 text-nav-ink sm:px-3">
        <NavLink to="/pos" end className={tab} aria-label="Phòng bàn">
          <LayoutGrid size={18} /> <span className="hidden sm:inline">Phòng bàn</span>
        </NavLink>
        <NavLink to="/pos/order" className={tab} aria-label="Thực đơn">
          <UtensilsCrossed size={18} /> <span className="hidden sm:inline">Thực đơn</span>
        </NavLink>
        <NavLink to="/pos/orders" className={tab} aria-label="Đơn hàng">
          <ReceiptText size={18} /> <span className="hidden md:inline">Đơn hàng</span>
        </NavLink>
        <NavLink to="/pos/day-closing" className={tab} aria-label="Chốt ngày">
          <CalendarCheck size={18} /> <span className="hidden md:inline">Chốt ngày</span>
        </NavLink>
        <SearchInput
          ref={searchRef}
          className="mb-2 ml-2 hidden h-9 w-72 lg:flex"
          aria-label="Tìm món"
          placeholder="Tìm món (F3)"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            if (!location.pathname.startsWith('/pos/order')) navigate('/pos/order');
          }}
          onKeyDown={(e) => e.key === 'Escape' && setSearch('')}
        />
        <div className="flex-1" />
        <div className="mb-2 flex items-center gap-1 text-[13px]">
          <span className="hidden px-2 xl:inline">{user?.fullName}</span>
          <Link
            to="/kitchen"
            aria-label="Màn hình bếp"
            title="Màn hình bếp"
            className="inline-flex size-9 items-center justify-center rounded-ctl hover:bg-white/60"
          >
            <ChefHat size={18} />
          </Link>
          {user?.role === 'ADMIN' && (
            <Link
              to="/admin"
              aria-label="Quản trị"
              title="Quản trị"
              className="inline-flex size-9 items-center justify-center rounded-ctl hover:bg-white/60"
            >
              <Settings2 size={18} />
            </Link>
          )}
          <button
            aria-label="Đổi người / đăng xuất"
            title="Đổi người / đăng xuất"
            onClick={() => {
              logout();
              navigate('/login');
            }}
            className="inline-flex size-9 items-center justify-center rounded-ctl hover:bg-white/60"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>
      {!online && (
        <div
          role="alert"
          className="flex items-center justify-center gap-2 bg-bad-soft px-3 py-1.5 text-[13px] font-medium text-bad-ink"
        >
          <WifiOff size={16} /> Mất kết nối tới máy chủ — dữ liệu có thể chưa cập nhật, đang thử kết nối lại…
        </div>
      )}
      <div className="min-h-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
