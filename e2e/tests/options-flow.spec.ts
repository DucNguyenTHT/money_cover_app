import { expect, test } from '@playwright/test';
import { api, login, makeDish, retireCreated } from './helpers';

test.afterAll(async ({ request }) => retireCreated(request));

const stockOf = async (request: Parameters<typeof api>[0], ingredientId: number) => {
  const rows = await (
    await api(request)
  ).get<{ ingredientId: number; qtyOnHand: string }[]>('/api/inventory');
  return Number(rows.find((r) => r.ingredientId === ingredientId)?.qtyOnHand ?? 0);
};

const option = (name: string, price: string, extra: Record<string, unknown> = {}) => ({
  id: null,
  name,
  price,
  recipeFactor: '1',
  isDefault: false,
  active: true,
  sort: 0,
  ingredients: [],
  ...extra,
});

test('dish options: pick size + topping on the POS, price and stock follow', async ({ page, request }) => {
  const { dishId, dishName, ingredientId } = await makeDish(request); // 60.000, 150 g beef
  const a = await api(request);
  const tag = Date.now().toString(36);
  // Size has no default: the POS must ask.
  const size = await a.post<{ id: number }>('/api/option-groups', {
    name: `Size ${tag}`,
    multi: false,
    required: true,
    maxSelect: null,
    sort: 1,
    active: true,
    options: [option('Vừa', '0'), option('Lớn', '10000', { recipeFactor: '1.5' })],
  });
  const extra = await a.post<{ id: number }>('/api/option-groups', {
    name: `Thêm ${tag}`,
    multi: true,
    required: false,
    maxSelect: null,
    sort: 2,
    active: true,
    options: [option('Thêm bò', '20000', { ingredients: [{ ingredientId, qty: '50' }] })],
  });
  await a.put(`/api/dishes/${dishId}/option-groups`, { groupIds: [size.id, extra.id] });
  const before = await stockOf(request, ingredientId);

  await login(page);
  await page.goto('/pos');
  await page.getByRole('button', { name: 'Mang về' }).click();
  await page.waitForURL('**/pos/order');
  await page.getByLabel('Tìm món').fill(dishName);
  await page.locator('main button', { hasText: dishName }).click();

  // The picker: nothing chosen yet → adding is refused until a size is picked.
  const picker = page.getByRole('dialog', { name: dishName });
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: /^Thêm · / }).click();
  await expect(picker.getByText(`Chọn Size ${tag}`)).toBeVisible();
  await picker.getByRole('radio', { name: 'Lớn' }).click();
  await picker.getByRole('checkbox', { name: /Thêm bò/ }).click();
  await picker.getByRole('button', { name: 'Thêm · 90.000' }).click();

  const panel = page.getByRole('complementary');
  await expect(panel.getByText('Lớn · Thêm bò')).toBeVisible();
  await expect(panel.getByText('90.000').last()).toBeVisible();

  // After the kitchen has it, "+" orders one more portion with the same options (a new line).
  await page.getByRole('button', { name: /Gửi bếp/ }).click();
  await expect(page.getByText('Đã gửi bếp / bar')).toBeVisible();
  await panel.getByRole('button', { name: `Thêm ${dishName}` }).click();
  await expect(panel.getByText('Lớn · Thêm bò')).toHaveCount(2);
  await expect(panel.getByText('180.000').last()).toBeVisible();

  await page.getByRole('button', { name: /Thanh toán/ }).click();
  await page.getByRole('button', { name: /Xác nhận thanh toán/ }).click();
  await expect(page.getByText(/^Đã thanh toán/)).toBeVisible();
  // Beef: 2 × (150 g × 1,5 + 50 g extra) = 550 g.
  await expect.poll(() => stockOf(request, ingredientId)).toBeCloseTo(before - 0.55, 4);
});
