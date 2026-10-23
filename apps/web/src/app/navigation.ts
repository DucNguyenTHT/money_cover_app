import type { Role } from '@ketoan/api/domain';
import {
  ListPlus,
  PackageSearch,
  BarChart3,
  Bike,
  BookOpen,
  CalendarClock,
  Boxes,
  Calculator,
  ChefHat,
  ClipboardList,
  Coins,
  Contact,
  FileImage,
  FileSpreadsheet,
  Landmark,
  LayoutDashboard,
  Receipt,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Store,
  Truck,
  UserCog,
  Users,
  Wallet,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';

/** One source of truth for the admin menu: module (top bar) → group → item → children (left sidebar). */
export interface NavLeaf {
  label: string;
  path: string;
  roles?: Role[];
}
export interface NavItem extends Partial<NavLeaf> {
  label: string;
  icon: LucideIcon;
  children?: NavLeaf[];
}
export interface NavGroup {
  title: string;
  items: NavItem[];
}
export interface NavModule {
  key: string;
  label: string;
  /** Landing path when the module is clicked in the top bar. */
  path: string;
  roles?: Role[];
  groups: NavGroup[];
}

const A: Role[] = ['ADMIN'];

export const NAV: NavModule[] = [
  {
    key: 'overview',
    label: 'Tổng quan',
    path: '/admin',
    roles: A,
    groups: [
      { title: 'Tổng quan', items: [{ label: 'Bảng điều khiển', icon: LayoutDashboard, path: '/admin' }] },
    ],
  },
  {
    key: 'menu',
    label: 'Thực đơn',
    path: '/admin/menu/dishes',
    roles: A,
    groups: [
      {
        title: 'Thực đơn',
        items: [
          { label: 'Món & nhóm món', icon: BookOpen, path: '/admin/menu/dishes' },
          { label: 'Tuỳ chọn món', icon: ListPlus, path: '/admin/menu/options' },
          { label: 'Nguyên liệu', icon: Boxes, path: '/admin/menu/ingredients' },
        ],
      },
      {
        title: 'Giá',
        items: [
          {
            label: 'Giá thành & giá bán',
            icon: Calculator,
            children: [
              { label: 'Bảng tính giá', path: '/admin/menu/cost-sheet' },
              { label: 'Cảnh báo giá', path: '/admin/menu/price-alerts' },
              { label: 'Lịch sử giá bán', path: '/admin/menu/price-history' },
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'inventory',
    label: 'Kho hàng',
    path: '/admin/inventory/receipts',
    groups: [
      {
        title: 'Nhập & xuất',
        items: [
          { label: 'Phiếu nhập', icon: Receipt, path: '/admin/inventory/receipts' },
          { label: 'Cần nhập hàng', icon: PackageSearch, path: '/admin/inventory/reorder' },
          { label: 'Nhà cung cấp & công nợ', icon: Truck, path: '/admin/inventory/suppliers' },
          {
            label: 'Phiếu xuất',
            icon: ClipboardList,
            children: [
              { label: 'Tất cả phiếu xuất', path: '/admin/inventory/issues' },
              { label: 'Xuất huỷ', path: '/admin/inventory/issues?reason=DISPOSAL' },
              { label: 'Trả nhà cung cấp', path: '/admin/inventory/issues?reason=SUPPLIER_RETURN' },
              { label: 'Dùng nội bộ', path: '/admin/inventory/issues?reason=INTERNAL_USE' },
            ],
          },
        ],
      },
      {
        title: 'Kiểm kho',
        items: [
          { label: 'Kiểm kê', icon: ShieldCheck, path: '/admin/inventory/stocktakes' },
          {
            label: 'Tồn kho',
            icon: Warehouse,
            children: [
              { label: 'Tồn hiện tại', path: '/admin/inventory/stock' },
              { label: 'Nợ kho', path: '/admin/inventory/pending' },
              { label: 'Lịch sử giá nhập', path: '/admin/inventory/price-history' },
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'documents',
    label: 'Chứng từ',
    path: '/admin/documents',
    groups: [
      {
        title: 'Chứng từ',
        items: [{ label: 'Hoá đơn & chứng từ', icon: FileImage, path: '/admin/documents' }],
      },
    ],
  },
  {
    key: 'orders',
    label: 'Đơn hàng',
    path: '/admin/orders',
    roles: A,
    groups: [
      {
        title: 'Đơn hàng',
        items: [
          { label: 'Danh sách đơn', icon: ShoppingCart, path: '/admin/orders' },
          { label: 'Chốt ngày', icon: Store, path: '/admin/orders/day-closings' },
        ],
      },
    ],
  },
  {
    key: 'accounting',
    label: 'Kế toán',
    path: '/admin/accounting/overheads',
    roles: A,
    groups: [
      {
        title: 'Kế toán',
        items: [
          { label: 'Sổ quỹ tiền mặt', icon: Wallet, path: '/admin/accounting/cash' },
          { label: 'Chi phí chung', icon: Coins, path: '/admin/accounting/overheads' },
          { label: 'Khoá sổ tháng', icon: ShieldCheck, path: '/admin/accounting/periods' },
        ],
      },
    ],
  },
  {
    key: 'staff',
    label: 'Nhân viên',
    path: '/admin/staff/attendance',
    roles: A,
    groups: [
      {
        title: 'Nhân viên',
        items: [
          { label: 'Lịch & chấm công', icon: CalendarClock, path: '/admin/staff/attendance' },
          { label: 'Bảng lương', icon: Contact, path: '/admin/staff/payroll' },
          { label: 'Nhân viên & ca làm', icon: UserCog, path: '/admin/staff/employees' },
        ],
      },
    ],
  },
  {
    key: 'reports',
    label: 'Báo cáo',
    path: '/admin/reports/pnl',
    roles: A,
    groups: [
      {
        title: 'Tài chính',
        items: [
          {
            label: 'Lãi lỗ',
            icon: BarChart3,
            children: [
              { label: 'Lãi lỗ tháng', path: '/admin/reports/pnl' },
              { label: 'Lãi lỗ quý / năm', path: '/admin/reports/pnl-range' },
              { label: 'Lãi theo món', path: '/admin/reports/dish-profit' },
            ],
          },
          { label: 'Thuế phải nộp', icon: Landmark, path: '/admin/reports/tax' },
        ],
      },
      {
        title: 'Bán hàng',
        items: [
          {
            label: 'Bán hàng',
            icon: ShoppingCart,
            children: [
              { label: 'Cuối ngày', path: '/admin/reports/daily' },
              { label: 'Theo kênh, giờ, nhân viên', path: '/admin/reports/sales' },
              { label: 'Đơn & món huỷ, giảm giá', path: '/admin/reports/cancellations' },
            ],
          },
        ],
      },
      {
        title: 'Kho',
        items: [
          {
            label: 'Kho',
            icon: Warehouse,
            children: [
              { label: 'Nhập – xuất – tồn', path: '/admin/reports/stock-movement' },
              { label: 'Chênh lệch định mức', path: '/admin/reports/variance' },
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'system',
    label: 'Hệ thống',
    path: '/admin/system/users',
    roles: A,
    groups: [
      {
        title: 'Hệ thống',
        items: [
          { label: 'Tài khoản', icon: Users, path: '/admin/system/users' },
          { label: 'Bàn & khu vực', icon: Store, path: '/admin/system/tables' },
          { label: 'App giao hàng', icon: Bike, path: '/admin/system/delivery-apps' },
          { label: 'Máy in & trạm', icon: ChefHat, path: '/admin/system/printers' },
          { label: 'Nhập dữ liệu Excel', icon: FileSpreadsheet, path: '/admin/system/import' },
          { label: 'Cài đặt', icon: Settings, path: '/admin/system/settings' },
          { label: 'Lịch sử sửa', icon: ClipboardList, path: '/admin/system/audit-logs' },
        ],
      },
    ],
  },
];

const allowed = (roles: Role[] | undefined, role: Role) => !roles || roles.includes(role);

/** The menu as seen by `role` (modules / items / children the user may not open are removed). */
export function navFor(role: Role): NavModule[] {
  return NAV.filter((m) => allowed(m.roles, role)).map((m) => ({
    ...m,
    groups: m.groups
      .map((g) => ({
        ...g,
        items: g.items
          .filter((i) => allowed(i.roles, role))
          .map((i) => ({ ...i, children: i.children?.filter((c) => allowed(c.roles, role)) })),
      }))
      .filter((g) => g.items.length > 0),
  }));
}

/** Path without its query string, used to match the current location. */
const bare = (p: string) => p.split('?')[0]!;

/** Which module owns `pathname` (longest matching item path wins). */
export function moduleFor(modules: NavModule[], pathname: string): NavModule | undefined {
  let best: { m: NavModule; len: number } | undefined;
  for (const m of modules) {
    const paths = [
      m.path,
      ...m.groups.flatMap((g) => g.items.flatMap((i) => [i.path, ...(i.children ?? []).map((c) => c.path)])),
    ];
    for (const p of paths) {
      if (!p) continue;
      const b = bare(p);
      if ((pathname === b || pathname.startsWith(b + '/')) && (!best || b.length > best.len))
        best = { m, len: b.length };
    }
  }
  return best?.m;
}
