import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const USER = process.env.E2E_USER ?? '';
export const PASS = process.env.E2E_PASS ?? '';
if (!USER || !PASS)
  throw new Error('Set E2E_USER and E2E_PASS (an ADMIN account) before running the e2e tests');

export async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập').fill(USER);
  await page.getByLabel('Mật khẩu').fill(PASS);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  // Browser printing would block the run.
  await page.addInitScript(() => {
    window.print = () => {};
  });
}

let cachedToken: string | null = null;

/** Small typed-enough API helper with the admin's token (logs in once: login is rate-limited). */
export async function api(request: APIRequestContext) {
  if (!cachedToken) {
    const res = await request.post('/api/auth/login', { data: { username: USER, password: PASS } });
    expect(res.ok(), `API login: ${res.status()}`).toBeTruthy();
    cachedToken = ((await res.json()) as { token: string }).token;
  }
  const token = cachedToken;
  const call = async <T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    data?: unknown,
  ): Promise<T> => {
    const r = await request.fetch(url, { method, data, headers: { authorization: `Bearer ${token}` } });
    if (!r.ok()) throw new Error(`${method} ${url} → ${r.status()} ${await r.text()}`);
    return (await r.json()) as T;
  };
  return {
    get: <T>(u: string) => call<T>('GET', u),
    post: <T>(u: string, d: unknown) => call<T>('POST', u, d),
    put: <T>(u: string, d: unknown) => call<T>('PUT', u, d),
    patch: <T>(u: string, d: unknown) => call<T>('PATCH', u, d),
    del: <T>(u: string, d: unknown) => call<T>('DELETE', u, d),
  };
}

/** What the tests created, so `retireCreated` can hide it afterwards (rows stay: orders reference them). */
const created: {
  ingredients: { id: number; body: Record<string, unknown> }[];
  dishes: { id: number; body: Record<string, unknown> }[];
} = {
  ingredients: [],
  dishes: [],
};

export async function retireCreated(request: APIRequestContext) {
  const a = await api(request);
  for (const d of created.dishes.splice(0)) await a.put(`/api/dishes/${d.id}`, { ...d.body, active: false });
  for (const i of created.ingredients.splice(0))
    await a.put(`/api/ingredients/${i.id}`, { ...i.body, active: false });
}

/** One ingredient with stock and one dish using it, both with unique codes. Returns names. */
export async function makeDish(request: APIRequestContext) {
  const a = await api(request);
  const tag = Date.now().toString(36).toUpperCase();
  // Business date, not calendar date: the day starts at 04:00 (default business_day_start), so a run
  // between 00:00 and 04:00 still sells on yesterday's date.
  const today = new Date(Date.now() + (7 - 4) * 3600_000).toISOString().slice(0, 10);
  const ingBody = {
    code: `E2E-NL-${tag}`,
    name: `Bò e2e ${tag}`,
    kind: 'INGREDIENT',
    unit: 'kg',
    recipeUnit: 'g',
    recipeFactor: '1000',
    purchaseUnit: null,
    purchaseFactor: '1',
    category: 'E2E',
    active: true,
  };
  const ing = await a.post<{ id: number }>('/api/ingredients', ingBody);
  created.ingredients.push({ id: ing.id, body: ingBody });
  await a.post('/api/receipts', {
    kind: 'PURCHASE',
    date: today,
    supplier: 'E2E',
    note: null,
    items: [{ ingredientId: ing.id, qty: '10', unitPrice: '200000', unitMode: 'STOCK' }],
  });
  const cats = await a.get<{ id: number; station: string }[]>('/api/dish-categories');
  const cat = cats.find((c) => c.station === 'KITCHEN')!;
  const dishName = `Phở e2e ${tag}`;
  const dishBody = { code: `E2E${tag}`, name: dishName, categoryId: cat.id, active: true, sort: 999 };
  const dish = await a.post<{ id: number }>('/api/dishes', {
    ...dishBody,
    storePrice: '60000',
    appPrice: null,
  });
  created.dishes.push({ id: dish.id, body: dishBody });
  await a.post(`/api/dishes/${dish.id}/recipes`, {
    effectiveFrom: today,
    note: null,
    items: [{ ingredientId: ing.id, qty: '150', scope: 'ALL' }],
  });
  return { dishId: dish.id, dishName, ingredientName: `Bò e2e ${tag}`, ingredientId: ing.id, today };
}
