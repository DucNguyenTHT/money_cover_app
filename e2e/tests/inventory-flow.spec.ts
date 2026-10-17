import { expect, test } from '@playwright/test';
import { api, login, makeDish, retireCreated } from './helpers';

test.afterAll(async ({ request }) => retireCreated(request));

test('stocktake: count a shortage, complete, see it allocated to the dish, then cancel', async ({
  page,
  request,
}) => {
  const { dishName, ingredientName, ingredientId } = await makeDish(request);
  const a = await api(request);
  // Sell one portion so the dish has used the ingredient.
  const order = await a.post<{ id: number; version: number; total: string }>('/api/orders', {
    channel: 'TAKEAWAY',
    tableId: null,
    deliveryAppId: null,
    appOrderCode: null,
    guestCount: 1,
    note: null,
    items: [
      {
        dishId: (await a.get<{ id: number; name: string }[]>('/api/dishes')).find((d) => d.name === dishName)!
          .id,
        qty: 1,
      },
    ],
  });
  await a.post(`/api/orders/${order.id}/pay`, {
    version: order.version,
    print: false,
    payments: [{ method: 'CASH', amount: order.total }],
  });
  // Paying sent it to the kitchen; serve it so the test leaves the kitchen screen clean.
  for (const k of (
    await a.get<{ itemId: number; orderId: number }[]>('/api/kitchen/queue?station=KITCHEN')
  ).filter((k) => k.orderId === order.id)) {
    await a.patch(`/api/kitchen/items/${k.itemId}`, { status: 'SERVED' });
  }
  const book = Number(
    (await a.get<{ ingredientId: number; qtyOnHand: string }[]>('/api/inventory')).find(
      (r) => r.ingredientId === ingredientId,
    )!.qtyOnHand,
  );

  // Only one draft may exist: cancel any left over by an interrupted run.
  for (const s of await a.get<{ id: number; status: string }[]>('/api/stocktakes')) {
    if (s.status === 'DRAFT')
      await a.post(`/api/stocktakes/${s.id}/cancel`, { reason: 'Dọn phiếu nháp trước khi chạy e2e' });
  }

  await login(page);
  await page.goto('/admin/inventory/stocktakes');
  await page.getByRole('button', { name: 'Tạo phiếu kiểm kê' }).click();
  await page.getByRole('button', { name: 'Tạo phiếu', exact: true }).click();
  await page.waitForURL(/stocktakes\/\d+$/);

  // 100 g missing at 200.000 / kg → 20.000 shortage.
  await page.getByLabel(`Tồn thực tế ${ingredientName}`).fill((book - 0.1).toFixed(3).replace('.', ','));
  await expect(page.getByText('Thiếu 0,1 kg')).toBeVisible();
  await page.getByRole('button', { name: 'Chốt kiểm kê' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Chốt', exact: true }).click();
  await expect(page.getByText('Đã chốt kiểm kê')).toBeVisible();
  const allocation = page.locator('div', { hasText: 'Phân bổ hao hụt vào món' }).getByText(dishName);
  await expect(allocation).toBeVisible();

  // Cancel restores the lot (cleanup + checks the reverse path).
  await page.getByRole('button', { name: 'Huỷ phiếu' }).click();
  await page.getByRole('dialog').last().getByRole('textbox').fill('Kiểm thử e2e — huỷ');
  await page.getByRole('dialog').last().getByRole('button', { name: 'Huỷ phiếu' }).click();
  await expect(page.getByText('Đã huỷ phiếu kiểm kê')).toBeVisible();
  await expect
    .poll(async () =>
      Number(
        (await a.get<{ ingredientId: number; qtyOnHand: string }[]>('/api/inventory')).find(
          (r) => r.ingredientId === ingredientId,
        )!.qtyOnHand,
      ),
    )
    .toBeCloseTo(book, 4);
});
