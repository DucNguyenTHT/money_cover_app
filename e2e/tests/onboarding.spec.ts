import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';

/**
 * A brand-new shop, exactly as the owner meets it: first login → new password → PIN → shop name →
 * Excel import of ingredients, dishes, recipes, opening stock → sell one bowl → see it in the P&L.
 * Needs a FRESH database: ONBOARD_PASS = the temporary admin password (set by setup-db.mjs on the e2e database;
 * against a real fresh install, the one printed by the seed). Runs before the other specs (playwright.config.ts).
 */
const TEMP = process.env.ONBOARD_PASS ?? '';
const NEW_PASS = 'Quan-pho-2026';
test.skip(!TEMP, 'Set ONBOARD_PASS (temporary admin password of a fresh install) to run');

async function importSheet(page: Page, kind: string, rows: (string | number)[][]) {
  await page.getByRole('button', { name: kind, exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Tải file mẫu' }).click(),
  ]);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(readFileSync((await download.path())!) as unknown as ArrayBuffer);
  const ws = wb.worksheets[0]!;
  ws.spliceRows(2, ws.rowCount - 1); // drop the example row
  for (const r of rows) ws.addRow(r);
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  await page.locator('input[type=file]').setInputFiles({
    name: `${kind}.xlsx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer,
  });
  await expect(page.getByText(`${rows.length} hợp lệ`)).toBeVisible();
  const commit = page.getByRole('button', { name: `Nhập ${rows.length} dòng` });
  await commit.click();
  // The preview closes once the rows are saved (an error would keep it open with a message).
  await expect(commit).toBeHidden();
  await expect(page.getByText(/Đã nhập: \d+ mới/).last()).toBeVisible();
}

test('fresh install → first sale shows in the monthly P&L', async ({ page }) => {
  await page.addInitScript(() => {
    window.print = () => {};
  });

  // First login: forced password change, then the approval PIN.
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập').fill('admin');
  await page.getByLabel('Mật khẩu').fill(TEMP);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await page.waitForURL('**/setup/password');
  await page.getByLabel('Mật khẩu hiện tại (tạm thời)').fill(TEMP);
  await page.getByLabel('Mật khẩu mới', { exact: true }).fill(NEW_PASS);
  await page.getByLabel('Nhập lại mật khẩu mới').fill(NEW_PASS);
  await page.getByRole('button', { name: 'Lưu mật khẩu' }).click();
  await page.waitForURL('**/setup/pin');
  await page.getByLabel('Mật khẩu của bạn').fill(NEW_PASS);
  await page.getByLabel('Mã PIN', { exact: true }).fill('2580');
  await page.getByLabel('Nhập lại mã PIN').fill('2580');
  await page.getByRole('button', { name: 'Lưu mã PIN' }).click();
  await page.waitForURL(/\/admin$/);
  await expect(page.getByText('Thiết lập ban đầu')).toBeVisible();

  // Shop details.
  await page.goto('/admin/system/settings');
  await page.getByLabel('Tên quán').fill('Quán Phở Thử');
  await page.getByRole('button', { name: 'Lưu cài đặt' }).first().click();
  await expect(page.getByText(/Đã lưu/)).toBeVisible();

  // Menu and stock from the Excel templates.
  await page.goto('/admin/system/import');
  await importSheet(page, 'Nguyên liệu', [
    ['NL001', 'Thịt bò', 'Nguyên liệu', 'Thịt', 'kg', 'g', 1000, '', ''],
    ['NL002', 'Bánh phở', 'Nguyên liệu', 'Tinh bột', 'kg', 'g', 1000, '', ''],
  ]);
  await importSheet(page, 'Món', [['PHO01', 'Phở bò', 'Món nước', 'Bếp', 50000, 60000]]);
  await importSheet(page, 'Định mức', [
    ['PHO01', 'NL001', 150, 'Tất cả'],
    ['PHO01', 'NL002', 250, 'Tất cả'],
  ]);
  await importSheet(page, 'Tồn đầu', [
    ['NL001', 5, 260000],
    ['NL002', 10, 18000],
  ]);

  // First sale: takeaway, cash.
  await page.goto('/pos');
  await page.getByRole('button', { name: 'Mang về' }).click();
  await page.waitForURL('**/pos/order');
  await page.locator('main button', { hasText: 'Phở bò' }).click();
  await expect(page.getByText('Chưa gửi bếp')).toBeVisible();
  await page.getByRole('button', { name: /Thanh toán/ }).click();
  await page.getByRole('button', { name: /Xác nhận thanh toán/ }).click();
  await expect(page.getByText(/Đã thanh toán/)).toBeVisible();

  // It shows in the monthly P&L: 50.000 revenue, cost 0,15 kg × 260.000 + 0,25 kg × 18.000 = 43.500.
  await page.goto('/admin/reports/pnl');
  const row = (label: string) => page.getByRole('row', { name: new RegExp(`^\\d+\\s*${label}`) });
  await expect(row('Doanh thu thuần')).toContainText('50.000');
  await expect(row('Giá vốn hàng bán')).toContainText('43.500');
  await expect(row('Lãi gộp')).toContainText('6.500');
});
