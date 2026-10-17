// Stocktake screens on the dev servers: create a draft, type counts, screenshot, then cancel it.
// Usage: node stocktake-flow.mjs <outDir> <username> <password>
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [outDir = 'shots', username, password] = process.argv.slice(2);
const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();

for (const vp of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  const page = await browser.newPage({ viewport: vp });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = async (name) => {
    await page.waitForTimeout(500);
    const file = `${outDir}/stocktake_${vp.width}_${name}.png`;
    await page.screenshot({ path: file, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    console.log(`${file}${overflow ? '  [!] tràn ngang' : ''}`);
  };
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Tên đăng nhập').fill(username);
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));

  await page.goto(`${BASE}/admin/inventory/stocktakes`);
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Tạo phiếu kiểm kê' }).click();
  await page.getByRole('button', { name: 'Tạo phiếu', exact: true }).click();
  await page.waitForURL(/stocktakes\/\d+/);
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Tồn thực tế Thịt bò').fill('7,5');
  await page.getByLabel('Tồn thực tế Bánh phở').fill('12');
  await page.getByLabel('Tồn thực tế Coca lon').fill('46');
  await shot('edit');
  await page.getByRole('button', { name: 'Huỷ phiếu' }).click();
  await page.getByRole('textbox').last().fill('Chỉ chụp màn hình thử');
  await page.getByRole('button', { name: 'Huỷ phiếu' }).last().click();
  await page.waitForTimeout(600);
  await page.goto(`${BASE}/admin/inventory/stocktakes`);
  await page.waitForLoadState('networkidle');
  await shot('list');
  if (errors.length) console.log('JS errors:', errors);
  await page.close();
}
await browser.close();
