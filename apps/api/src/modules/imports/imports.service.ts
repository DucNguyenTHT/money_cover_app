// Excel import of catalog data and opening stock. The client uploads the .xlsx as base64;
// every row is validated first (preview) and nothing is saved unless all rows are valid (commit).
import ExcelJS from 'exceljs';
import { prisma, inTx, type Tx } from '../../core/db';
import { badRequest } from '../../core/errors';
import { writeAudit } from '../../core/audit';
import { defaultBranchId } from '../../core/branch';
import { assertPeriodOpen } from '../../core/period-lock';
import { toDbDate } from '../../domain/business-date';
import { recipeToStock } from '../../domain/recipes/recipes';
import { D } from '../../domain/money';
import type { ImportKind, ImportPreview } from '../../contracts/imports.contract';
import { businessToday } from '../settings/settings.service';
import { settlePendingWithLot } from '../inventory/stock-engine';
import { unitChange } from '../catalog/ingredients.service';

const FIELD_KEYS = [
  'code',
  'name',
  'kind',
  'category',
  'unit',
  'recipeUnit',
  'recipeFactor',
  'purchaseUnit',
  'purchaseFactor',
  'station',
  'storePrice',
  'appPrice',
  'dishCode',
  'ingredientCode',
  'qty',
  'scope',
  'unitPrice',
] as const;
type FieldKey = (typeof FIELD_KEYS)[number];
/** Every known column, '' when absent from the sheet. */
type Fields = Record<FieldKey, string>;

interface ColumnSpec {
  key: FieldKey;
  header: string;
  example: string | number;
  required?: boolean;
  note?: string;
}

export const SPECS: Record<ImportKind, { title: string; columns: ColumnSpec[] }> = {
  ingredients: {
    title: 'Nguyên liệu',
    columns: [
      { key: 'code', header: 'Mã', example: 'NL001', required: true },
      { key: 'name', header: 'Tên nguyên liệu', example: 'Thịt bò', required: true },
      { key: 'kind', header: 'Loại', example: 'Nguyên liệu', note: '"Nguyên liệu" hoặc "Bao bì"' },
      { key: 'category', header: 'Nhóm', example: 'Thịt' },
      { key: 'unit', header: 'Đơn vị kho', example: 'kg', required: true },
      { key: 'recipeUnit', header: 'Đơn vị định mức', example: 'g', note: 'Để trống = giống đơn vị kho' },
      { key: 'recipeFactor', header: '1 đơn vị kho = ? đơn vị định mức', example: 1000 },
      { key: 'purchaseUnit', header: 'Đơn vị mua', example: '' },
      { key: 'purchaseFactor', header: '1 đơn vị mua = ? đơn vị kho', example: '' },
    ],
  },
  dishes: {
    title: 'Món',
    columns: [
      { key: 'code', header: 'Mã món', example: 'PHO01', required: true },
      { key: 'name', header: 'Tên món', example: 'Phở bò tái', required: true },
      { key: 'category', header: 'Nhóm món', example: 'Món nước', required: true },
      { key: 'station', header: 'Trạm', example: 'Bếp', note: '"Bếp" hoặc "Bar" (nhóm mới)' },
      { key: 'storePrice', header: 'Giá tại quán', example: 55000 },
      { key: 'appPrice', header: 'Giá app', example: 65000 },
    ],
  },
  recipes: {
    title: 'Định mức',
    columns: [
      { key: 'dishCode', header: 'Mã món', example: 'PHO01', required: true },
      { key: 'ingredientCode', header: 'Mã nguyên liệu', example: 'NL001', required: true },
      { key: 'qty', header: 'Định mức / phần (đơn vị định mức)', example: 200, required: true },
      {
        key: 'scope',
        header: 'Áp dụng cho',
        example: 'Tất cả',
        note: '"Tất cả" hoặc "Mang về / App" (bao bì)',
      },
    ],
  },
  opening: {
    title: 'Tồn đầu',
    columns: [
      { key: 'ingredientCode', header: 'Mã nguyên liệu', example: 'NL001', required: true },
      { key: 'qty', header: 'Số lượng (đơn vị kho)', example: 12.5, required: true },
      { key: 'unitPrice', header: 'Giá vốn / đơn vị kho', example: 250000, required: true },
    ],
  },
};

// ---------------------------------------------------------------- template & parsing

/** Optional dish-sheet column "Giá <app>" per active delivery app: that app's own price. */
const appPriceHeader = (name: string) => `Giá ${name}`;
const activeApps = () => prisma.deliveryApp.findMany({ where: { active: true }, orderBy: { id: 'asc' } });

export async function template(kind: ImportKind): Promise<Buffer> {
  const base = SPECS[kind];
  const spec: { title: string; columns: ColumnSpec[] } =
    kind === 'dishes'
      ? {
          ...base,
          columns: [
            ...base.columns,
            ...(await activeApps()).map((a) => ({
              key: 'appPrice' as const,
              header: appPriceHeader(a.name),
              example: '',
              note: `Giá riêng trên ${a.name}. Để trống = dùng "Giá app"`,
            })),
          ],
        }
      : base;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(spec.title);
  ws.addRow(spec.columns.map((c) => c.header + (c.required ? ' *' : '')));
  ws.addRow(spec.columns.map((c) => c.example));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF4FE' } };
  spec.columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = Math.max(14, c.header.length + 4);
    if (c.note) ws.getCell(1, i + 1).note = c.note;
  });
  const help = wb.addWorksheet('Hướng dẫn');
  help.addRow(['Cột có dấu * là bắt buộc. Dòng 2 là ví dụ — xoá hoặc sửa trước khi nhập.']);
  for (const c of spec.columns) help.addRow([c.header, c.note ?? '']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const cellText = (v: ExcelJS.CellValue): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return String(v.text);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return String(v).trim();
};

interface ParsedRow {
  row: number;
  data: Fields;
  /** Cells of columns outside the spec, by lower-cased header. */
  extra: Record<string, string>;
}

async function parse(kind: ImportKind, fileBase64: string): Promise<ParsedRow[]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Buffer.from(fileBase64, 'base64') as unknown as ArrayBuffer);
  } catch {
    throw badRequest('Không đọc được file. Hãy dùng file .xlsx theo mẫu.');
  }
  const ws = wb.worksheets[0];
  if (!ws) throw badRequest('File không có trang tính nào');
  const spec = SPECS[kind];
  const headers = (ws.getRow(1).values as ExcelJS.CellValue[]).map((v) =>
    cellText(v)
      .replace(/\s*\*$/, '')
      .toLowerCase(),
  );
  const colOf = new Map(spec.columns.map((c) => [c.key, headers.indexOf(c.header.toLowerCase())]));
  const missing = spec.columns.filter((c) => c.required && (colOf.get(c.key) ?? -1) < 0).map((c) => c.header);
  if (missing.length) throw badRequest(`Thiếu cột: ${missing.join(', ')}. Hãy dùng file mẫu.`);

  const known = new Set(colOf.values());
  const extraCols = headers.flatMap((h, i) => (i > 0 && h && !known.has(i) ? [[h, i] as const] : []));

  const out: ParsedRow[] = [];
  ws.eachRow((r, rowNumber) => {
    if (rowNumber === 1) return;
    const data = Object.fromEntries(FIELD_KEYS.map((k) => [k, ''])) as Fields;
    for (const c of spec.columns) {
      const idx = colOf.get(c.key) ?? -1;
      data[c.key] = idx > 0 ? cellText(r.getCell(idx).value) : '';
    }
    const extra = Object.fromEntries(extraCols.map(([h, i]) => [h, cellText(r.getCell(i).value)]));
    if ([...Object.values(data), ...Object.values(extra)].every((v) => v === '')) return;
    out.push({ row: rowNumber, data, extra });
  });
  if (out.length === 0) throw badRequest('File không có dòng dữ liệu nào');
  if (out.length > 2000) throw badRequest('Tối đa 2.000 dòng mỗi lần nhập');
  return out;
}

// ---------------------------------------------------------------- validation → plan

const num = (s: string) => {
  if (s === '') return null;
  const n = Number(s.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};

interface Planned {
  row: number;
  action: 'CREATE' | 'UPDATE' | 'ERROR';
  label: string;
  errors: string[];
  apply?: (
    tx: Tx,
    ctx: { userId: number; date: string; branchId: number; receiptId?: number },
  ) => Promise<void>;
}

async function plan(kind: ImportKind, rows: ParsedRow[]): Promise<Planned[]> {
  const seen = new Set<string>();
  const dup = (key: string, errors: string[]) => {
    if (seen.has(key)) errors.push('Trùng với dòng phía trên');
    seen.add(key);
  };

  if (kind === 'ingredients') {
    const existing = new Map(
      (
        await prisma.ingredient.findMany({
          include: { _count: { select: { lots: true, recipeItems: true, optionItems: true } } },
        })
      ).map((i) => [i.code.toLowerCase(), i]),
    );
    return rows.map(({ row, data: d }) => {
      const errors: string[] = [];
      if (!d.code) errors.push('Thiếu mã');
      if (!d.name) errors.push('Thiếu tên');
      if (!d.unit) errors.push('Thiếu đơn vị kho');
      const kindV = d.kind?.toLowerCase().startsWith('bao') ? 'PACKAGING' : 'INGREDIENT';
      const recipeFactor = num(d.recipeFactor ?? '') ?? 1;
      const purchaseFactor = num(d.purchaseFactor ?? '') ?? 1;
      if (Number.isNaN(recipeFactor) || recipeFactor <= 0) errors.push('Hệ số định mức không hợp lệ');
      if (Number.isNaN(purchaseFactor) || purchaseFactor <= 0) errors.push('Hệ số đơn vị mua không hợp lệ');
      if (d.purchaseUnit && !d.purchaseFactor) errors.push('Có đơn vị mua thì phải có hệ số quy đổi');
      dup(d.code.toLowerCase(), errors);
      const prev = existing.get(d.code.toLowerCase());
      const data = {
        code: d.code,
        name: d.name,
        kind: kindV as 'INGREDIENT' | 'PACKAGING',
        category: d.category || null,
        unit: d.unit,
        recipeUnit: d.recipeUnit || d.unit,
        recipeFactor: d.recipeUnit ? recipeFactor : 1,
        purchaseUnit: d.purchaseUnit || null,
        purchaseFactor,
      };
      if (
        prev &&
        !errors.length &&
        (prev._count.lots > 0 || prev._count.recipeItems > 0 || prev._count.optionItems > 0) &&
        unitChange(prev, { ...data, recipeFactor: String(data.recipeFactor) })
      )
        errors.push('Đã có tồn kho / định mức: không đổi được đơn vị kho, đơn vị định mức, hệ số quy đổi');
      return {
        row,
        action: errors.length ? 'ERROR' : prev ? 'UPDATE' : 'CREATE',
        label: `${d.code} · ${d.name}`,
        errors,
        apply: async (tx) => {
          if (prev) await tx.ingredient.update({ where: { id: prev.id }, data });
          else await tx.ingredient.create({ data });
        },
      };
    });
  }

  if (kind === 'dishes') {
    const existing = new Map((await prisma.dish.findMany()).map((x) => [x.code.toLowerCase(), x]));
    const apps = await activeApps();
    return rows.map(({ row, data: d, extra }) => {
      const errors: string[] = [];
      if (!d.code) errors.push('Thiếu mã món');
      if (!d.name) errors.push('Thiếu tên món');
      if (!d.category) errors.push('Thiếu nhóm món');
      const store = num(d.storePrice ?? '');
      const app = num(d.appPrice ?? '');
      if (Number.isNaN(store) || (store !== null && store < 0)) errors.push('Giá tại quán không hợp lệ');
      if (Number.isNaN(app) || (app !== null && app < 0)) errors.push('Giá app không hợp lệ');
      const own = apps.map((a) => {
        const price = num(extra[appPriceHeader(a.name).toLowerCase()] ?? '');
        if (Number.isNaN(price) || (price !== null && price < 0)) errors.push(`Giá ${a.name} không hợp lệ`);
        return { appId: a.id as number | null, price };
      });
      dup(d.code.toLowerCase(), errors);
      const prev = existing.get(d.code.toLowerCase());
      const station = d.station?.toLowerCase() === 'bar' ? 'BAR' : 'KITCHEN';
      return {
        row,
        action: errors.length ? 'ERROR' : prev ? 'UPDATE' : 'CREATE',
        label: `${d.code} · ${d.name}`,
        errors,
        apply: async (tx, ctx) => {
          let cat = await tx.dishCategory.findFirst({
            where: { name: { equals: d.category, mode: 'insensitive' } },
          });
          if (!cat) cat = await tx.dishCategory.create({ data: { name: d.category!, station, sort: 99 } });
          const dish = prev
            ? await tx.dish.update({ where: { id: prev.id }, data: { name: d.name, categoryId: cat.id } })
            : await tx.dish.create({ data: { code: d.code!, name: d.name!, categoryId: cat.id } });
          for (const [type, appId, price] of [
            ['STORE', null, store],
            ['APP', null, app],
            ...own.map((o) => ['APP', o.appId, o.price] as const),
          ] as const) {
            if (price === null || Number.isNaN(price)) continue;
            const key = {
              dishId: dish.id,
              priceType: type,
              deliveryAppId: appId,
              effectiveFrom: toDbDate(ctx.date),
            };
            const prevPrice = await tx.dishPrice.findFirst({ where: key });
            if (prevPrice)
              await tx.dishPrice.update({
                where: { id: prevPrice.id },
                data: { price, createdById: ctx.userId },
              });
            else await tx.dishPrice.create({ data: { ...key, price, createdById: ctx.userId } });
          }
        },
      };
    });
  }

  if (kind === 'recipes') {
    const dishes = new Map((await prisma.dish.findMany()).map((x) => [x.code.toLowerCase(), x]));
    const ings = new Map((await prisma.ingredient.findMany()).map((x) => [x.code.toLowerCase(), x]));
    const parsed = rows.map(({ row, data: d }) => {
      const errors: string[] = [];
      const dish = dishes.get((d.dishCode ?? '').toLowerCase());
      const ing = ings.get((d.ingredientCode ?? '').toLowerCase());
      if (!dish) errors.push(`Không có món mã "${d.dishCode}"`);
      if (!ing) errors.push(`Không có nguyên liệu mã "${d.ingredientCode}"`);
      const qty = num(d.qty ?? '');
      if (qty === null || Number.isNaN(qty) || qty <= 0) errors.push('Định mức phải là số lớn hơn 0');
      const scope =
        d.scope?.toLowerCase().includes('mang') || d.scope?.toLowerCase().includes('app')
          ? 'TAKEAWAY_APP'
          : 'ALL';
      dup(`${d.dishCode}|${d.ingredientCode}|${scope}`.toLowerCase(), errors);
      return { row, d, dish, ing, qty: qty ?? 0, scope: scope as 'ALL' | 'TAKEAWAY_APP', errors };
    });
    // One recipe version per dish (all its rows together), effective from the import date.
    const byDish = new Map<number, typeof parsed>();
    for (const p of parsed) if (p.dish) byDish.set(p.dish.id, [...(byDish.get(p.dish.id) ?? []), p]);
    return parsed.map((p, idx) => ({
      row: p.row,
      action: p.errors.length ? 'ERROR' : 'CREATE',
      label: `${p.d.dishCode} ← ${p.d.ingredientCode} ${p.d.qty}`,
      errors: p.errors,
      apply:
        // apply once per dish, on its first row
        p.dish && parsed.findIndex((x) => x.dish?.id === p.dish!.id) === idx
          ? async (tx, ctx) => {
              const lines = byDish.get(p.dish!.id)!;
              const effectiveFrom = toDbDate(ctx.date);
              const existing = await tx.dishRecipe.findUnique({
                where: { dishId_effectiveFrom: { dishId: p.dish!.id, effectiveFrom } },
                include: { _count: { select: { orderItems: true } } },
              });
              if (existing?._count.orderItems)
                throw badRequest(`Định mức món ${p.dish!.code} ngày này đã dùng cho đơn hàng`);
              if (existing) await tx.dishRecipe.delete({ where: { id: existing.id } });
              await tx.dishRecipe.create({
                data: {
                  dishId: p.dish!.id,
                  effectiveFrom,
                  note: 'Nhập từ Excel',
                  items: {
                    create: lines.map((l) => ({
                      ingredientId: l.ing!.id,
                      scope: l.scope,
                      qty: recipeToStock(l.qty, l.ing!.recipeFactor.toString()).toDecimalPlaces(4).toString(),
                    })),
                  },
                },
              });
            }
          : undefined,
    }));
  }

  // opening stock
  const ings = new Map((await prisma.ingredient.findMany()).map((x) => [x.code.toLowerCase(), x]));
  return rows.map(({ row, data: d }) => {
    const errors: string[] = [];
    const ing = ings.get((d.ingredientCode ?? '').toLowerCase());
    if (!ing) errors.push(`Không có nguyên liệu mã "${d.ingredientCode}"`);
    const qty = num(d.qty ?? '');
    const price = num(d.unitPrice ?? '');
    if (qty === null || Number.isNaN(qty) || qty <= 0) errors.push('Số lượng phải lớn hơn 0');
    if (price === null || Number.isNaN(price) || price < 0) errors.push('Giá vốn không hợp lệ');
    dup((d.ingredientCode ?? '').toLowerCase(), errors);
    return {
      row,
      action: errors.length ? 'ERROR' : 'CREATE',
      label: `${d.ingredientCode} · ${ing?.name ?? ''} · ${d.qty} ${ing?.unit ?? ''}`,
      errors,
      apply: async (tx, ctx) => {
        const item = await tx.receiptItem.create({
          data: {
            receiptId: ctx.receiptId!,
            ingredientId: ing!.id,
            qty: String(qty),
            unitPrice: String(price),
            amount: D(qty!).mul(price!).toDecimalPlaces(0).toString(),
          },
        });
        const lot = await tx.lot.create({
          data: {
            branchId: ctx.branchId,
            ingredientId: ing!.id,
            date: toDbDate(ctx.date),
            unitPrice: String(price),
            qtyIn: String(qty),
            qtyRemaining: String(qty),
            receiptItemId: item.id,
          },
        });
        await settlePendingWithLot(tx, lot.id);
      },
    };
  });
}

export async function preview(kind: ImportKind, fileBase64: string): Promise<ImportPreview> {
  const planned = await plan(kind, await parse(kind, fileBase64));
  return {
    total: planned.length,
    valid: planned.filter((p) => p.action !== 'ERROR').length,
    rows: planned.map(({ row, action, label, errors }) => ({ row, action, label, errors })),
  };
}

export async function commit(userId: number, kind: ImportKind, fileBase64: string, dateIn?: string) {
  const planned = await plan(kind, await parse(kind, fileBase64));
  const bad = planned.filter((p) => p.action === 'ERROR');
  if (bad.length)
    throw badRequest(`Còn ${bad.length} dòng lỗi — sửa file rồi nhập lại`, { rows: bad.map((b) => b.row) });
  const date = dateIn ?? (await businessToday());
  const branchId = await defaultBranchId();
  await inTx(async (tx) => {
    await assertPeriodOpen(tx, date);
    let receiptId: number | undefined;
    if (kind === 'opening') {
      receiptId = (
        await tx.receipt.create({
          data: {
            branchId,
            kind: 'OPENING',
            date: toDbDate(date),
            note: 'Nhập tồn đầu từ Excel',
            createdById: userId,
          },
        })
      ).id;
    }
    for (const p of planned) await p.apply?.(tx, { userId, date, branchId, receiptId });
    await writeAudit(tx, {
      entity: 'import',
      entityId: kind,
      action: 'IMPORT',
      after: { rows: planned.length, date },
      userId,
    });
  });
  return {
    created: planned.filter((p) => p.action === 'CREATE').length,
    updated: planned.filter((p) => p.action === 'UPDATE').length,
  };
}
