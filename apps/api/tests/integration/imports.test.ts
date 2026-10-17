import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { prisma } from '../../src/core/db';
import { SPECS } from '../../src/modules/imports/imports.service';
import type { ImportKind } from '../../src/contracts/imports.contract';
import { makeUser, resetDb, startServer, stopServer } from '../helpers/harness';

beforeAll(startServer);
afterAll(stopServer);
beforeEach(resetDb);

async function xlsx(kind: ImportKind, rows: (string | number)[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(SPECS[kind].columns.map((c) => c.header + (c.required ? ' *' : '')));
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
}

describe('Excel import', () => {
  it('previews errors without saving, then imports ingredients → dishes → recipes → opening stock', async () => {
    const { client } = await makeUser({ username: 'quanly', role: 'ADMIN' });

    const bad = await xlsx('ingredients', [
      ['NL1', 'Thịt bò', 'Nguyên liệu', 'Thịt', 'kg', 'g', 1000, '', ''],
      ['', 'Không mã', '', '', 'kg', '', '', '', ''],
    ]);
    const prev = await client.imports.preview({ params: { kind: 'ingredients' }, body: { fileBase64: bad } });
    expect(prev.body).toMatchObject({
      total: 2,
      valid: 1,
      rows: [{ action: 'CREATE' }, { action: 'ERROR', errors: ['Thiếu mã'] }],
    });
    expect(
      (await client.imports.commit({ params: { kind: 'ingredients' }, body: { fileBase64: bad } })).status,
    ).toBe(400);
    expect(await prisma.ingredient.count()).toBe(0);

    const ings = await xlsx('ingredients', [
      ['NL1', 'Thịt bò', 'Nguyên liệu', 'Thịt', 'kg', 'g', 1000, '', ''],
      ['NL2', 'Coca', 'Nguyên liệu', 'Nước', 'lon', '', '', 'thùng', 24],
      ['BB1', 'Hộp giấy', 'Bao bì', '', 'cái', '', '', '', ''],
    ]);
    expect(
      (await client.imports.commit({ params: { kind: 'ingredients' }, body: { fileBase64: ings } })).body,
    ).toEqual({ created: 3, updated: 0 });
    const coca = await prisma.ingredient.findUniqueOrThrow({ where: { code: 'NL2' } });
    expect(coca.purchaseFactor.toString()).toBe('24');
    expect(coca.recipeUnit).toBe('lon');

    const dishes = await xlsx('dishes', [
      ['PHO', 'Phở bò', 'Món nước', 'Bếp', 55000, 65000],
      ['COCA', 'Coca lon', 'Đồ uống', 'Bar', 15000, ''],
    ]);
    expect(
      (
        await client.imports.commit({
          params: { kind: 'dishes' },
          body: { fileBase64: dishes, date: '2026-10-01' },
        })
      ).body,
    ).toEqual({ created: 2, updated: 0 });
    const bar = await prisma.dishCategory.findFirstOrThrow({ where: { name: 'Đồ uống' } });
    expect(bar.station).toBe('BAR');

    const recipes = await xlsx('recipes', [
      ['PHO', 'NL1', 200, 'Tất cả'],
      ['PHO', 'BB1', 1, 'Mang về / App'],
      ['COCA', 'NL2', 1, 'Tất cả'],
    ]);
    expect(
      (
        await client.imports.commit({
          params: { kind: 'recipes' },
          body: { fileBase64: recipes, date: '2026-10-01' },
        })
      ).status,
    ).toBe(200);
    const pho = await prisma.dish.findUniqueOrThrow({
      where: { code: 'PHO' },
      include: { recipes: { include: { items: true } } },
    });
    expect(pho.recipes[0]!.items.map((i) => [i.qty.toString(), i.scope]).sort()).toEqual([
      ['0.2', 'ALL'],
      ['1', 'TAKEAWAY_APP'],
    ]);

    const opening = await xlsx('opening', [
      ['NL1', 12.5, 250000],
      ['NL2', 48, 10000],
    ]);
    expect(
      (
        await client.imports.commit({
          params: { kind: 'opening' },
          body: { fileBase64: opening, date: '2026-09-30' },
        })
      ).status,
    ).toBe(200);
    const receipt = await prisma.receipt.findFirstOrThrow({ include: { items: true } });
    expect(receipt.kind).toBe('OPENING');
    expect(receipt.items).toHaveLength(2);
    expect(await prisma.lot.count()).toBe(2);
  });

  it('rejects files missing required columns', async () => {
    const { client } = await makeUser({ username: 'quanly', role: 'ADMIN' });
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('x').addRow(['Tên']);
    const file = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
    const res = await client.imports.preview({ params: { kind: 'ingredients' }, body: { fileBase64: file } });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { message: expect.stringContaining('Thiếu cột') } });
  });
});
