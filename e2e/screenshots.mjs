// Take screenshots of key screens on the running dev servers (web :5173 + api :4000).
// Usage: node screenshots.mjs <outDir> <username> <password> [path1 path2 ...]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [outDir = 'shots', username, password, ...paths] = process.argv.slice(2);
const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
// SIZES=768,1024 to check other widths (tablets); default desktop + phone.
const viewports = process.env.SIZES
  ? process.env.SIZES.split(',').map((w) => ({
      name: `w${w}`,
      width: Number(w),
      height: Number(w) > 900 ? 768 : 1024,
    }))
  : [
      { name: 'desktop', width: 1440, height: 900 },
      { name: 'phone', width: 390, height: 844 },
    ];
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
for (const vp of viewports) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Tên đăng nhập').fill(username);
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  for (const p of paths) {
    const [path, action] = p.split('#');
    await page.goto(`${BASE}${path}`);
    await page.waitForLoadState('networkidle');
    if (action) {
      await page.getByRole('button', { name: action }).first().click();
      await page.waitForTimeout(400);
    }
    const file = `${outDir}/${vp.name}${path.replace(/[/?=&]/g, '_')}${action ? '_' + action.replace(/\s/g, '-') : ''}.png`;
    await page.screenshot({ path: file, fullPage: !action });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    console.log(`${file}${overflow ? '  [!] tràn ngang' : ''}`);
  }
  if (errors.length) console.log(`[${vp.name}] JS errors:`, errors);
  await page.close();
}
await browser.close();
