import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { api, login } from './helpers';

/** A unique JPEG drawn in the browser (unique bytes, so the duplicate check never trips between runs). */
async function invoicePhoto(page: Page, label: string): Promise<Buffer> {
  const b64 = await page.evaluate((text) => {
    const c = document.createElement('canvas');
    c.width = 1200;
    c.height = 1600;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#222';
    ctx.font = '48px sans-serif';
    ctx.fillText('HOÁ ĐƠN GIÁ TRỊ GIA TĂNG', 120, 160);
    ctx.fillText(text, 120, 260);
    return c.toDataURL('image/jpeg', 0.9).split(',')[1]!;
  }, label);
  return Buffer.from(b64, 'base64');
}

test('documents: file an invoice with a photo, view it, find it by month and by year', async ({
  page,
  request,
}) => {
  const partner = `NCC e2e ${Date.now()}`;
  await login(page);
  await page.goto('/admin/documents');
  await expect(page.getByRole('heading', { name: 'Chứng từ' })).toBeVisible();

  await page.getByRole('button', { name: 'Thêm chứng từ' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Thêm chứng từ' });
  await dialog.getByLabel('Nhà cung cấp / đối tác').fill(partner);
  await dialog.getByLabel('Số hoá đơn').fill('0001234');
  await dialog.getByLabel('Số tiền (₫)').fill('1250000');
  await dialog.locator('input[type=file][multiple]').setInputFiles({
    name: 'hoa-don.jpg',
    mimeType: 'image/jpeg',
    buffer: await invoicePhoto(page, partner),
  });
  await expect(dialog.getByText('hoa-don.jpg')).toBeVisible();
  await dialog.getByRole('button', { name: 'Lưu chứng từ' }).click();
  await expect(page.getByText('Đã lưu chứng từ và 1 file')).toBeVisible();

  // Listed in the current month with its amount.
  const row = page.getByRole('row').filter({ hasText: partner });
  await expect(row).toContainText('1.250.000');

  // Open it and view the photo full size.
  await row.click();
  const detail = page.getByRole('dialog', { name: /Chứng từ ngày/ });
  await detail.getByRole('button', { name: 'hoa-don.jpg', exact: true }).click();
  const viewer = page.getByRole('dialog', { name: /hoa-don\.jpg \(1\/1\)/ });
  await expect(viewer.getByRole('img', { name: 'hoa-don.jpg' })).toBeVisible();
  await viewer.getByRole('button', { name: 'Đóng' }).first().click();

  // Add two more photos at once, replace one, delete one (own upload: no reason needed).
  await detail.locator('input[type=file][multiple]').setInputFiles([
    { name: 'trang-2.jpg', mimeType: 'image/jpeg', buffer: await invoicePhoto(page, `${partner} trang 2`) },
    { name: 'trang-3.jpg', mimeType: 'image/jpeg', buffer: await invoicePhoto(page, `${partner} trang 3`) },
  ]);
  await expect(page.getByText('Đã lưu 2 file')).toBeVisible();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    detail.getByRole('button', { name: 'Thay trang-2.jpg' }).click(),
  ]);
  await chooser.setFiles({
    name: 'trang-2-ro.jpg',
    mimeType: 'image/jpeg',
    buffer: await invoicePhoto(page, `${partner} trang 2 rõ hơn`),
  });
  await expect(page.getByText('Đã thay file')).toBeVisible();
  await expect(detail.getByRole('button', { name: 'trang-2-ro.jpg', exact: true })).toBeVisible();
  await expect(detail.getByRole('button', { name: 'trang-2.jpg', exact: true })).toHaveCount(0);

  await detail.getByRole('button', { name: 'Xoá trang-3.jpg' }).click();
  await page
    .getByRole('dialog', { name: 'Xoá file khỏi chứng từ' })
    .getByRole('button', { name: 'Xoá file' })
    .click();
  await expect(page.getByText('Đã xoá file')).toBeVisible();
  await expect(detail.getByRole('button', { name: 'trang-3.jpg', exact: true })).toHaveCount(0);
  await detail.getByRole('button', { name: 'Đóng' }).first().click();
  await expect(row).toContainText('2'); // hoa-don.jpg + trang-2-ro.jpg

  // Year view + search still find it.
  await page.getByRole('button', { name: 'Năm', exact: true }).click();
  await page.getByLabel('Tìm chứng từ').fill(partner);
  await expect(page.getByRole('row').filter({ hasText: partner })).toBeVisible();

  // Backup dialog: the year's documents download as one .zip.
  await page.getByRole('button', { name: 'Sao lưu / Google Drive' }).click();
  const backup = page.getByRole('dialog', { name: 'Sao lưu chứng từ' });
  await expect(backup).toContainText(`năm ${new Date().getFullYear()}`);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    backup.getByRole('button', { name: 'Tải file nén về máy' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(`chung-tu-${new Date().getFullYear()}.zip`);
  const zip = await readFile((await download.path())!);
  expect(zip.subarray(0, 2).toString()).toBe('PK');
  expect(zip.toString('utf8')).toContain(partner);
  await backup.getByRole('button', { name: 'Đóng' }).last().click();

  // Clean up (soft delete, files stay on disk).
  const a = await api(request);
  const list = await a.get<{ rows: { id: number; partner: string }[] }>(
    `/api/documents?period=${new Date().getFullYear()}&q=${encodeURIComponent(partner)}`,
  );
  for (const d of list.rows) await a.del(`/api/documents/${d.id}`, { reason: 'Dọn dữ liệu e2e' });
});
