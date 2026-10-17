import { useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { ChevronLeft, ChevronRight, LogOut, Menu, ShoppingCart, UserRound, X } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { NotificationBell } from '@/components/alerts';
import { moduleFor, navFor, type NavItem, type NavModule } from '@/app/navigation';
import { cn } from '@/lib/cn';

type Loc = { pathname: string; search: string };

/** A nav path is active when its pathname matches and, if it has a query, the query matches too. */
function isActive(path: string, loc: Loc) {
  const [p, q] = path.split('?') as [string, string | undefined];
  if (p !== loc.pathname) return false;
  if (!q) return !loc.search || loc.search === '?';
  return new URLSearchParams(loc.search).toString() === new URLSearchParams(q).toString();
}

export function AdminLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const modules = useMemo(() => navFor(user!.role), [user]);
  const current = moduleFor(modules, location.pathname) ?? modules[0];
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);

  useEffect(() => setDrawer(false), [location.pathname, location.search]);

  return (
    <div className="flex min-h-full flex-col">
      {/* Top bar: modules */}
      <header className="sticky top-0 z-30 flex h-[52px] items-center gap-1 border-b border-nav-line bg-nav px-3 text-nav-ink">
        <button
          className="mr-1 inline-flex size-10 items-center justify-center rounded-ctl lg:hidden"
          aria-label="Mở menu"
          onClick={() => setDrawer(true)}
        >
          <Menu size={20} />
        </button>
        <Link to="/admin" className="mr-4 flex items-center gap-2 font-bold">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-[13px] text-white">
            Q
          </span>
          <span className="hidden whitespace-nowrap sm:inline lg:hidden xl:inline">Quán ăn</span>
        </Link>
        <nav aria-label="Khu chức năng" className="hidden h-full items-center gap-0.5 lg:flex">
          {modules.map((m) => (
            <Link
              key={m.key}
              to={m.path}
              aria-current={m.key === current?.key ? 'page' : undefined}
              className={cn(
                'flex h-9 items-center whitespace-nowrap rounded-ctl px-2.5 text-sm font-medium transition-colors xl:px-3.5',
                m.key === current?.key
                  ? 'bg-white text-primary-ink shadow-[var(--shadow-btn)]'
                  : 'hover:bg-white/60',
              )}
            >
              {m.label}
            </Link>
          ))}
        </nav>
        <div className="flex-1" />
        <Link
          to="/pos"
          aria-label="Bán hàng"
          className="inline-flex shrink-0 h-[34px] items-center gap-2 rounded-ctl bg-primary px-3.5 text-sm font-semibold text-white shadow-[var(--shadow-primary)] hover:bg-primary-hover"
        >
          <ShoppingCart size={16} />
          <span className="hidden whitespace-nowrap sm:inline lg:hidden xl:inline">Bán hàng</span>
        </Link>
        {user!.role === 'ADMIN' && <NotificationBell />}
        <UserMenu
          name={user!.fullName}
          onLogout={() => {
            logout();
            navigate('/login');
          }}
        />
      </header>

      <div className="flex flex-1">
        {/* Desktop sidebar: sub pages of the current module */}
        {current && (
          <aside
            className={cn(
              'sticky top-[52px] hidden h-[calc(100vh-52px)] shrink-0 flex-col border-r border-line-soft bg-white transition-[width] lg:flex',
              collapsed ? 'w-[68px]' : 'w-[236px]',
            )}
          >
            <Sidebar module={current} loc={location} collapsed={collapsed} />
            <button
              onClick={() => setCollapsed((c) => !c)}
              className="m-2 flex h-9 items-center gap-2 rounded-ctl px-2.5 text-[13px] font-medium text-muted hover:bg-track"
            >
              {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
              {!collapsed && 'Thu gọn menu'}
            </button>
          </aside>
        )}

        <main className="min-w-0 flex-1 p-4 lg:p-5">
          <Outlet />
        </main>
      </div>

      {/* Mobile drawer: both levels */}
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-ink/30" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[300px] max-w-[85%] flex-col overflow-y-auto bg-white shadow-[var(--shadow-pop)]">
            <div className="flex h-[52px] items-center justify-between border-b border-line-soft px-3">
              <span className="font-bold text-ink-strong">Menu</span>
              <button
                aria-label="Đóng menu"
                className="inline-flex size-10 items-center justify-center"
                onClick={() => setDrawer(false)}
              >
                <X size={20} />
              </button>
            </div>
            <div className="flex gap-1.5 overflow-x-auto border-b border-line-soft p-2">
              {modules.map((m) => (
                <Link
                  key={m.key}
                  to={m.path}
                  className={cn(
                    'shrink-0 rounded-ctl px-3 py-2 text-[13px] font-medium',
                    m.key === current?.key ? 'bg-primary-soft text-primary-ink' : 'text-muted',
                  )}
                >
                  {m.label}
                </Link>
              ))}
            </div>
            {current && <Sidebar module={current} loc={location} collapsed={false} />}
          </div>
        </div>
      )}
    </div>
  );
}

function Sidebar({ module, loc, collapsed }: { module: NavModule; loc: Loc; collapsed: boolean }) {
  return (
    <nav
      aria-label={`Menu ${module.label}`}
      className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 py-3"
    >
      {module.groups.map((g) => (
        <div key={g.title} className="flex flex-col gap-0.5">
          {!collapsed && (
            <div className="px-2.5 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">
              {g.title}
            </div>
          )}
          {g.items.map((item) => (
            <SidebarItem key={item.label} item={item} loc={loc} collapsed={collapsed} />
          ))}
        </div>
      ))}
    </nav>
  );
}

function SidebarItem({ item, loc, collapsed }: { item: NavItem; loc: Loc; collapsed: boolean }) {
  const Icon = item.icon;
  const kids = item.children ?? [];
  const hasActiveChild = kids.some((c) => isActive(c.path, loc) || loc.pathname === c.path.split('?')[0]);
  const [open, setOpen] = useState(hasActiveChild);
  useEffect(() => {
    if (hasActiveChild) setOpen(true);
  }, [hasActiveChild]);

  const rowBase = 'flex h-10 items-center gap-2.5 rounded-ctl px-2.5 text-sm transition-colors';

  if (kids.length === 0 && item.path) {
    const active = isActive(item.path, loc);
    return (
      <Link
        to={item.path}
        title={collapsed ? item.label : undefined}
        aria-current={active ? 'page' : undefined}
        className={cn(
          rowBase,
          active
            ? 'bg-primary-soft font-semibold text-primary-ink'
            : 'font-medium text-[#344054] hover:bg-track',
        )}
      >
        <Icon size={17} className="shrink-0" />
        {!collapsed && <span className="truncate">{item.label}</span>}
      </Link>
    );
  }

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={collapsed ? item.label : undefined}
        className={cn(
          rowBase,
          'w-full text-left hover:bg-track',
          hasActiveChild ? 'font-semibold text-primary-ink' : 'font-medium text-[#344054]',
        )}
      >
        <Icon size={17} className="shrink-0" />
        {!collapsed && (
          <>
            <span className="flex-1 truncate">{item.label}</span>
            <ChevronRight
              size={14}
              className={cn('shrink-0 text-[#98a2b3] transition-transform', open && 'rotate-90')}
            />
          </>
        )}
      </button>
      {open && !collapsed && (
        <div className="mb-1.5 ml-[18px] mt-0.5 flex flex-col gap-0.5 border-l border-[#e3e8ef] pl-2.5">
          {kids.map((c) => {
            const active = isActive(c.path, loc);
            return (
              <Link
                key={c.path}
                to={c.path}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-[34px] items-center rounded-lg px-2.5 text-[13.5px]',
                  active ? 'bg-primary-soft font-semibold text-primary-ink' : 'text-[#475467] hover:bg-track',
                )}
              >
                {c.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function UserMenu({ name, onLogout }: { name: string; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex h-10 items-center gap-2 rounded-ctl px-2 text-[13px] font-medium hover:bg-white/60"
      >
        <span className="flex size-7 items-center justify-center rounded-full bg-[#d6e4fb] text-xs font-bold">
          {name.slice(0, 1).toUpperCase()}
        </span>
        <span className="hidden max-w-[120px] truncate md:inline">{name}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 w-52 rounded-card border border-line-soft bg-white p-1.5 text-sm text-ink shadow-[var(--shadow-pop)]">
            <Link
              to="/admin/me"
              onClick={() => setOpen(false)}
              className="flex h-9 items-center gap-2 rounded-lg px-2.5 hover:bg-track"
            >
              <UserRound size={16} /> Tài khoản của tôi
            </Link>
            <button
              onClick={onLogout}
              className="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-bad-ink hover:bg-bad-soft"
            >
              <LogOut size={16} /> Đăng xuất
            </button>
          </div>
        </>
      )}
    </div>
  );
}
