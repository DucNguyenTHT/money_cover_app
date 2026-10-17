import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { login } from './helpers';

/** WCAG 2 A/AA scan of the main screens. Serious / critical violations fail the test. */
const PAGES = [
  '/pos',
  '/pos/orders',
  '/pos/day-closing',
  '/kitchen',
  '/admin',
  '/admin/menu/dishes',
  '/admin/menu/cost-sheet',
  '/admin/inventory/receipts',
  '/admin/inventory/stock',
  '/admin/inventory/stocktakes',
  '/admin/documents',
  '/admin/reports/pnl',
  '/admin/reports/tax',
  '/admin/reports/dish-profit',
  '/admin/accounting/periods',
  '/admin/system/settings',
];

test('main screens have no serious accessibility problems', async ({ page }) => {
  await login(page);
  const report: string[] = [];
  for (const path of PAGES) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    for (const v of r.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical')) {
      report.push(
        `${path} · ${v.id} (${v.impact}) · ${v.help} · ${v.nodes.length}× e.g. ${v.nodes[0]?.target.join(' ')}`,
      );
    }
  }
  expect(report, report.join('\n')).toEqual([]);
});
