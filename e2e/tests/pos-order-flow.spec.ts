import { expect, test } from '@playwright/test';
import { api, login, makeDish, retireCreated } from './helpers';

test.afterAll(async ({ request }) => retireCreated(request));

const stockOf = async (request: Parameters<typeof api>[0], ingredientId: number) => {
  const rows = await (
    await api(request)
  ).get<{ ingredientId: number; qtyOnHand: string }[]>('/api/inventory');
  return Number(rows.find((r) => r.ingredientId === ingredientId)?.qtyOnHand ?? 0);
};

test('takeaway order: order → kitchen → pay → stock deducted → cancel → stock back', async ({
  page,
  context,
  request,
}) => {
  const { dishName, ingredientId } = await makeDish(request);
  const before = await stockOf(request, ingredientId);
  await login(page);

  // Start a takeaway order and add 2 portions via the dish search.
  await page.goto('/pos');
  await page.getByRole('button', { name: 'Mang về' }).click();
  await page.waitForURL('**/pos/order');
  await page.getByLabel('Tìm món').fill(dishName);
  const tile = page.locator('main button', { hasText: dishName });
  await tile.click();
  await expect(page.getByText('Chưa gửi bếp')).toBeVisible();
  await tile.click();
  await expect(page.getByRole('complementary').getByText('120.000').last()).toBeVisible();
  const code = (await page.getByText(/^#\d{6}-\d{3}$/).textContent())!.slice(1);

  // Send to the kitchen; the kitchen screen sees it and marks it done.
  await page.getByRole('button', { name: /Gửi bếp/ }).click();
  await expect(page.getByText('Đã gửi bếp / bar')).toBeVisible();
  const kitchen = await context.newPage();
  await kitchen.goto('/kitchen');
  const row = kitchen
    .locator('div', { hasText: dishName })
    .filter({ has: kitchen.getByRole('button', { name: 'Xong', exact: true }) })
    .last();
  await row.getByRole('button', { name: 'Xong', exact: true }).click();
  await expect(kitchen.getByText('Đã xong – chờ ra món')).toBeVisible();
  await kitchen.close();

  // Pay cash.
  await page.getByRole('button', { name: /Thanh toán/ }).click();
  await page.getByRole('button', { name: /Xác nhận thanh toán/ }).click();
  await expect(page.getByText(`Đã thanh toán ${code}`)).toBeVisible();
  await expect.poll(() => stockOf(request, ingredientId)).toBeCloseTo(before - 0.3, 4);

  // Cancel it from the order list (same day → staff-level rule, no PIN).
  await page.goto('/pos/orders');
  await page.getByLabel('Tìm mã đơn').fill(code);
  await page.getByRole('cell', { name: code }).click();
  await page.getByRole('button', { name: 'Huỷ đơn' }).click();
  // The kitchen marked it done, so it is pre-ticked as cooked (would be written off). Untick: nothing was made.
  const cooked = page.getByRole('checkbox', { name: `2 × ${dishName}` });
  await expect(cooked).toBeChecked();
  await cooked.uncheck();
  await page.getByRole('button', { name: 'Nhập nhầm đơn' }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Huỷ đơn' }).click();
  await expect(page.getByText(`Đã huỷ đơn ${code}`)).toBeVisible();
  await expect.poll(() => stockOf(request, ingredientId)).toBeCloseTo(before, 4);
});
