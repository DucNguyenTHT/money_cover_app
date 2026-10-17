// Walk through one sale on the running dev servers and screenshot each step (desktop + phone).
// Usage: node pos-flow.mjs <outDir> <username> <password>
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [outDir = 'shots', username, password] = process.argv.slice(2);
const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();

async function session(vp) {
  const ctx = await browser.newContext({ viewport: vp });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  // Browser printing opens the print dialog; stub it so the run never blocks.
  await page.addInitScript(() => {
    window.print = () => {};
  });
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Tên đăng nhập').fill(username);
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  const shot = async (name) => {
    await page.waitForTimeout(500);
    const file = `${outDir}/pos_${vp.width}_${name}.png`;
    await page.screenshot({ path: file });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    console.log(`${file}${overflow ? '  [!] tràn ngang' : ''}`);
  };
  return { page, shot, errors, ctx };
}

// ---- desktop: full sale
{
  const { page, shot, errors, ctx } = await session({ width: 1440, height: 900 });
  await page.goto(`${BASE}/pos`);
  await page.waitForLoadState('networkidle');
  await shot('1-tables');
  // first free table
  await page.locator('main [aria-pressed]').filter({ hasText: 'chỗ' }).first().click();
  await page.getByRole('button', { name: 'Gọi món' }).click();
  await page.waitForLoadState('networkidle');
  for (const name of ['Phở bò tái nạm', 'Phở bò tái nạm', 'Bún chả', 'Trà đá', 'Trà đá', 'Nước cam']) {
    await page.locator('main button', { hasText: name }).first().click();
    await page.waitForTimeout(250);
  }
  await shot('2-order');
  await page.getByRole('button', { name: /Gửi bếp/ }).click();
  await shot('3-sent');
  await page.getByRole('button', { name: 'Giảm giá' }).click();
  await page.getByRole('button', { name: '10', exact: true }).click();
  await page.getByRole('button', { name: 'Khách quen' }).click();
  await shot('4-discount');
  await page.getByRole('button', { name: 'Áp dụng' }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /Thanh toán/ }).click();
  await page.getByRole('button', { name: 'Chuyển khoản' }).click();
  await shot('5-pay');
  await page.getByRole('button', { name: 'Tiền mặt' }).click();
  await page.getByRole('button', { name: /Xác nhận thanh toán/ }).click();
  await page.waitForTimeout(800);
  await shot('6-after-pay');
  await page.goto(`${BASE}/kitchen`);
  await page.waitForLoadState('networkidle');
  await shot('7-kitchen');
  await page.goto(`${BASE}/pos/orders`);
  await page.waitForLoadState('networkidle');
  await shot('8-orders');
  await page.goto(`${BASE}/pos/day-closing`);
  await page.waitForLoadState('networkidle');
  await shot('9-day-closing');
  if (errors.length) console.log('[desktop] JS errors:', errors);
  await ctx.close();
}

// ---- phone: table map → order → order sheet
{
  const { page, shot, errors, ctx } = await session({ width: 390, height: 844 });
  await page.goto(`${BASE}/pos`);
  await page.waitForLoadState('networkidle');
  await shot('1-tables');
  await page.locator('main [aria-pressed]').filter({ hasText: 'chỗ' }).first().click();
  await page.waitForURL('**/pos/order');
  await page.waitForLoadState('networkidle');
  await page.locator('main button', { hasText: 'Bún bò Huế' }).first().click();
  await page.waitForTimeout(400);
  await shot('2-menu');
  await page.getByRole('button', { name: 'Xem đơn' }).click();
  await shot('3-panel');
  await page.goto(`${BASE}/kitchen`);
  await page.waitForLoadState('networkidle');
  await shot('4-kitchen');
  if (errors.length) console.log('[phone] JS errors:', errors);
  await ctx.close();
}
await browser.close();
