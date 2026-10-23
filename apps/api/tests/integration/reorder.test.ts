import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/core/db';
import { toDbDate } from '../../src/domain/business-date';
import { businessToday } from '../../src/modules/settings/settings.service';
import type { StockRow } from '../../src/contracts/inventory.contract';
import { makeUser, resetDb, startServer, stopServer } from '../helpers/harness';
import { branchId, makeIngredient } from '../helpers/factories';

beforeAll(startServer);
afterAll(stopServer);
beforeEach(resetDb);

const daysAgo = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) - n * 86400_000).toISOString().slice(0, 10);

describe('reorder suggestion', () => {
  it('uses the last 14 days of use, the minimum and the purchase unit', async () => {
    const { client, user } = await makeUser({ username: 'chu', role: 'ADMIN' });
    const today = await businessToday();
    const bid = await branchId();
    const beer = await makeIngredient({
      name: 'Bia lon',
      unit: 'lon',
      purchaseUnit: 'thùng',
      purchaseFactor: '24',
    });
    const salt = await makeIngredient({ name: 'Muối' });
    await prisma.lot.create({
      data: {
        branchId: bid,
        ingredientId: beer.id,
        date: toDbDate('2026-01-01'),
        unitPrice: 10000,
        qtyIn: 30,
        qtyRemaining: 30,
      },
    });
    // 140 cans used over the last 14 days → 10 a day; 30 left = 3 days.
    await prisma.issue.create({
      data: {
        branchId: bid,
        date: toDbDate(daysAgo(today, 3)),
        reason: 'SALE_USE',
        createdById: user.id,
        items: { create: { ingredientId: beer.id, qty: 140 } },
      },
    });
    // Older than 14 days: ignored.
    await prisma.issue.create({
      data: {
        branchId: bid,
        date: toDbDate(daysAgo(today, 20)),
        reason: 'SALE_USE',
        createdById: user.id,
        items: { create: { ingredientId: beer.id, qty: 500 } },
      },
    });
    await client.settings.update({ body: { settings: { reorder_days: 5 } } });

    const rows = (await client.inventory.stock()).body as StockRow[];
    const b = rows.find((r) => r.ingredientId === beer.id)!;
    // 5 days × 10 = 50 needed, 30 on hand → 20 cans → 1 carton of 24.
    expect(b).toMatchObject({
      dailyUse: '10',
      daysLeft: 3,
      status: 'LOW',
      suggestPurchaseQty: '1',
      suggestQty: '24',
    });
    expect(b.purchaseUnit).toBe('thùng');
    expect(rows.find((r) => r.ingredientId === salt.id)).toMatchObject({ status: 'OK', daysLeft: null });

    // A minimum flags an unused ingredient too, and shows on the dashboard.
    await client.catalog.updateIngredient({
      params: { id: salt.id },
      body: {
        code: salt.code,
        name: salt.name,
        kind: 'INGREDIENT',
        unit: 'kg',
        recipeUnit: 'g',
        recipeFactor: '1000',
        purchaseUnit: null,
        purchaseFactor: '1',
        category: null,
        active: true,
        minStock: '2',
      },
    });
    const salt2 = ((await client.inventory.stock()).body as StockRow[]).find(
      (r) => r.ingredientId === salt.id,
    )!;
    expect(salt2).toMatchObject({ status: 'OUT', minStock: '2', suggestQty: '2' });
    expect((await client.reports.dashboard()).body).toMatchObject({ alerts: { lowStock: 2 } });
  });
});
