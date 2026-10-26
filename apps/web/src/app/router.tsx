import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, Outlet, type RouteObject } from 'react-router';
import { RequireRole } from '@/auth/RequireRole';
import { LoginPage } from '@/auth/LoginPage';
import { SetupPasswordPage, SetupPinPage } from '@/auth/SetupPages';
import { homeFor, useAuth } from '@/auth/AuthProvider';
import { AdminLayout } from '@/layouts/AdminLayout';
import { PosLayout } from '@/layouts/PosLayout';
import { KitchenLayout } from '@/layouts/KitchenLayout';
import { RouteError } from '@/components/RouteError';

function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;
  return <Navigate to={user ? homeFor(user) : '/login'} replace />;
}

/** STAFF opening /admin lands on stock receipts (they have no dashboard). */
function AdminIndex() {
  const { user } = useAuth();
  if (user?.role !== 'ADMIN') return <Navigate to="/admin/inventory/receipts" replace />;
  return <Dashboard />;
}

/** Lazy route: each screen is its own chunk, so POS devices never download admin code. */
const page = (load: () => Promise<{ default: React.ComponentType }>): Pick<RouteObject, 'lazy'> => ({
  lazy: async () => ({ Component: (await load()).default }),
});
const lazyComponent = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  page(() => load().then((m) => ({ default: m[name] })));

const DashboardLazy = lazy(() =>
  import('@/features/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
const Dashboard = () => (
  <Suspense fallback={null}>
    <DashboardLazy />
  </Suspense>
);

const reports = () => import('@/features/reports/PnlPages');
const sales = () => import('@/features/reports/SalesReports');
const dishStock = () => import('@/features/reports/DishAndStockReports');
const stock = () => import('@/features/inventory/StockPages');
const stocktakes = () => import('@/features/stocktake/StocktakePages');

/** Screens under /admin. `staff: true` = STAFF may open it too (stock work); everything else is ADMIN only. */
const adminScreens: Record<string, Pick<RouteObject, 'lazy'> & { staff?: boolean }> = {
  me: { ...lazyComponent(() => import('@/auth/MyAccountPage'), 'MyAccountPage'), staff: true },
  'menu/dishes': lazyComponent(() => import('@/features/catalog/DishesPage'), 'DishesPage'),
  'menu/options': lazyComponent(() => import('@/features/catalog/OptionGroupsPage'), 'OptionGroupsPage'),
  'menu/ingredients': lazyComponent(() => import('@/features/catalog/IngredientsPage'), 'IngredientsPage'),
  'menu/promotions': lazyComponent(() => import('@/features/promotions/PromotionsPage'), 'PromotionsPage'),
  'menu/cost-sheet': lazyComponent(() => import('@/features/pricing/PricingPages'), 'CostSheetPage'),
  'menu/price-alerts': lazyComponent(() => import('@/features/pricing/PricingPages'), 'PriceAlertsPage'),
  'menu/price-history': lazyComponent(
    () => import('@/features/catalog/DishPriceHistoryPage'),
    'DishPriceHistoryPage',
  ),
  'inventory/reorder': {
    ...lazyComponent(() => import('@/features/inventory/ReorderPage'), 'ReorderPage'),
    staff: true,
  },
  'inventory/productions': {
    ...lazyComponent(() => import('@/features/production/ProductionsPage'), 'ProductionsPage'),
    staff: true,
  },
  'inventory/suppliers': {
    ...lazyComponent(() => import('@/features/inventory/SuppliersPage'), 'SuppliersPage'),
    staff: true,
  },
  'inventory/receipts': {
    ...lazyComponent(() => import('@/features/inventory/ReceiptsPage'), 'ReceiptsPage'),
    staff: true,
  },
  'inventory/issues': {
    ...lazyComponent(() => import('@/features/inventory/IssuesPage'), 'IssuesPage'),
    staff: true,
  },
  'inventory/stock': { ...lazyComponent(stock, 'StockPage'), staff: true },
  'inventory/pending': { ...lazyComponent(stock, 'PendingPage'), staff: true },
  'inventory/price-history': { ...lazyComponent(stock, 'PriceHistoryPage'), staff: true },
  'inventory/stocktakes': { ...lazyComponent(stocktakes, 'StocktakeListPage'), staff: true },
  'inventory/stocktakes/:id': { ...lazyComponent(stocktakes, 'StocktakeEditPage'), staff: true },
  documents: {
    ...lazyComponent(() => import('@/features/documents/DocumentsPage'), 'DocumentsPage'),
    staff: true,
  },
  customers: {
    ...lazyComponent(() => import('@/features/customers/CustomersPage'), 'CustomersPage'),
    staff: true,
  },
  reservations: {
    ...lazyComponent(() => import('@/features/reservations/ReservationsPage'), 'ReservationsPage'),
    staff: true,
  },
  orders: lazyComponent(() => import('@/features/order-history/OrderListPage'), 'OrderListPage'),
  'orders/day-closings': lazyComponent(
    () => import('@/features/day-closing/DayClosingPage'),
    'DayClosingPage',
  ),
  'accounting/overheads': lazyComponent(() => import('@/features/accounting/OverheadsPage'), 'OverheadsPage'),
  'accounting/cash': lazyComponent(() => import('@/features/cash/CashBookPage'), 'CashBookPage'),
  'accounting/bank': lazyComponent(() => import('@/features/bank/BankPage'), 'BankPage'),
  'accounting/einvoices': lazyComponent(() => import('@/features/einvoice/EInvoicesPage'), 'EInvoicesPage'),
  'accounting/periods': lazyComponent(() => import('@/features/accounting/PeriodsPage'), 'PeriodsPage'),
  'staff/attendance': lazyComponent(() => import('@/features/staff/AttendancePage'), 'AttendancePage'),
  'staff/payroll': lazyComponent(() => import('@/features/staff/PayrollPage'), 'PayrollPage'),
  'staff/employees': lazyComponent(() => import('@/features/staff/EmployeesPage'), 'EmployeesPage'),
  'reports/pnl': lazyComponent(reports, 'PnlMonthPage'),
  'reports/pnl-range': lazyComponent(reports, 'PnlRangePage'),
  'reports/tax': lazyComponent(() => import('@/features/reports/TaxReportPage'), 'TaxReportPage'),
  'reports/dish-profit': lazyComponent(dishStock, 'DishProfitPage'),
  'reports/stock-movement': lazyComponent(dishStock, 'StockMovementPage'),
  'reports/variance': lazyComponent(dishStock, 'VariancePage'),
  'reports/daily': lazyComponent(sales, 'DailyReportPage'),
  'reports/sales': lazyComponent(sales, 'SalesReportPage'),
  'reports/cancellations': lazyComponent(sales, 'CancellationsPage'),
  'system/users': lazyComponent(() => import('@/features/system/UsersPage'), 'UsersPage'),
  'system/tables': lazyComponent(() => import('@/features/system/TablesPage'), 'TablesPage'),
  'system/delivery-apps': lazyComponent(
    () => import('@/features/system/DeliveryAppsPage'),
    'DeliveryAppsPage',
  ),
  'system/printers': lazyComponent(() => import('@/features/system/PrintersPage'), 'PrintersPage'),
  'system/import': lazyComponent(() => import('@/features/system/ImportPage'), 'ImportPage'),
  'system/settings': lazyComponent(() => import('@/features/system/SettingsPage'), 'SettingsPage'),
  'system/audit-logs': lazyComponent(() => import('@/features/system/AuditLogPage'), 'AuditLogPage'),
};

const adminRoutes: RouteObject[] = Object.entries(adminScreens).map(([path, { staff, lazy: load }]) =>
  staff
    ? { path, lazy: load }
    : {
        path,
        element: (
          <RequireRole roles={['ADMIN']}>
            <Outlet />
          </RequireRole>
        ),
        children: [{ index: true, lazy: load }],
      },
);

export const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    children: [
      { path: '/', element: <RootRedirect /> },
      { path: '/login', element: <LoginPage /> },
      { path: '/setup/password', element: <SetupPasswordPage /> },
      { path: '/setup/pin', element: <SetupPinPage /> },
      {
        path: '/admin',
        element: (
          <RequireRole roles={['ADMIN', 'STAFF']}>
            <AdminLayout />
          </RequireRole>
        ),
        children: [{ index: true, element: <AdminIndex /> }, ...adminRoutes],
      },
      {
        path: '/pos',
        element: (
          <RequireRole roles={['ADMIN', 'STAFF']}>
            <PosLayout />
          </RequireRole>
        ),
        children: [
          { index: true, ...lazyComponent(() => import('@/features/tables/TableMapPage'), 'TableMapPage') },
          { path: 'order', ...lazyComponent(() => import('@/features/order-entry/OrderPage'), 'OrderPage') },
          {
            path: 'orders',
            ...lazyComponent(() => import('@/features/order-history/OrderListPage'), 'PosOrderListPage'),
          },
          {
            path: 'reservations',
            ...lazyComponent(() => import('@/features/reservations/ReservationsPage'), 'PosReservationsPage'),
          },
          {
            path: 'cash',
            ...lazyComponent(() => import('@/features/cash/CashBookPage'), 'PosCashBookPage'),
          },
          {
            path: 'day-closing',
            ...lazyComponent(() => import('@/features/day-closing/DayClosingPage'), 'PosDayClosingPage'),
          },
        ],
      },
      {
        path: '/kitchen',
        element: (
          <RequireRole roles={['ADMIN', 'STAFF', 'KITCHEN']}>
            <KitchenLayout />
          </RequireRole>
        ),
        children: [
          { index: true, ...lazyComponent(() => import('@/features/kitchen/KitchenPage'), 'KitchenPage') },
        ],
      },
      { path: '*', element: <RootRedirect /> },
    ],
  },
]);
