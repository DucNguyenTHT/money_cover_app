// Semi-finished goods (bán thành phẩm): their batch recipes, and productions — ingredients out (FIFO), one lot of
// the semi-finished good in, costed at what the ingredients cost. Dishes then use it like any ingredient (stock,
// stocktake, cost of a dish).
import type { Prisma } from '@prisma/client';
import { prisma, inTx } from '../../core/db';
import { badRequest, forbidden, notFound } from '../../core/errors';
import { writeAudit } from '../../core/audit';
import { assertPeriodOpen } from '../../core/period-lock';
import { defaultBranchId } from '../../core/branch';
import type { AuthUser } from '../../core/auth';
import type { ProductionDto, SemiDto, SemiRecipeDto } from '../../contracts/production.contract';
import { fromDbDate, toDbDate } from '../../domain/business-date';
import { D, ZERO, roundVnd } from '../../domain/money';
import { pickVersion } from '../../domain/recipes/recipes';
import {
  productionProblem,
  productionUnitCost,
  scaleRecipe,
  theoreticalUnitCost,
} from '../../domain/production/production';
import { businessToday } from '../settings/settings.service';
import {
  assertLotsUnused,
  createIssueFromLots,
  deleteIssueRestoringLots,
  settlePendingWithLot,
} from '../inventory/stock-engine';

const s = (d: Prisma.Decimal | null | undefined) => (d == null ? '0' : d.toString());

const recipeInclude = { items: { include: { ingredient: true }, orderBy: { id: 'asc' } } } as const;
type RecipeRow = Prisma.SemiRecipeGetPayload<{ include: typeof recipeInclude }>;

const recipeDto = (r: RecipeRow): SemiRecipeDto => ({
  id: r.id,
  effectiveFrom: fromDbDate(r.effectiveFrom),
  yieldQty: s(r.yieldQty),
  note: r.note,
  items: r.items.map((i) => ({
    ingredientId: i.ingredientId,
    name: i.ingredient.name,
    unit: i.ingredient.unit,
    qty: s(i.qty),
  })),
});

/** Latest lot price per ingredient (per stock unit). */
async function lotPrices(): Promise<Map<number, string>> {
  const lots = await prisma.lot.findMany({
    where: { branchId: await defaultBranchId() },
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
    distinct: ['ingredientId'],
    select: { ingredientId: true, unitPrice: true },
  });
  return new Map(lots.map((l) => [l.ingredientId, l.unitPrice.toString()]));
}

async function recipeAt(ingredientId: number, date: string) {
  const versions = await prisma.semiRecipe.findMany({ where: { ingredientId }, include: recipeInclude });
  return pickVersion(
    versions.map((r) => ({ ...r, effectiveFrom: fromDbDate(r.effectiveFrom), row: r })),
    date,
  )?.row;
}

/**
 * Price per stock unit of every ingredient for costing dishes: the latest lot price, except semi-finished goods
 * with a recipe, which cost their recipe at the latest input prices (a dearer bone shows in the dish at once).
 */
export async function costPrices(): Promise<Map<number, string>> {
  const prices = await lotPrices();
  const today = await businessToday();
  const recipes = await prisma.semiRecipe.findMany({
    where: { ingredient: { kind: 'SEMI' } },
    include: { items: true },
  });
  const byIng = new Map<number, typeof recipes>();
  for (const r of recipes) byIng.set(r.ingredientId, [...(byIng.get(r.ingredientId) ?? []), r]);
  for (const [ingredientId, versions] of byIng) {
    const r = pickVersion(
      versions.map((v) => ({ ...v, effectiveFrom: fromDbDate(v.effectiveFrom) })),
      today,
    );
    if (!r) continue;
    const c = theoreticalUnitCost(
      r.items.map((i) => ({ ingredientId: i.ingredientId, qty: i.qty.toString() })),
      r.yieldQty.toString(),
      prices,
    );
    if (c) prices.set(ingredientId, c.toString());
  }
  return prices;
}

export async function semis(): Promise<SemiDto[]> {
  const branchId = await defaultBranchId();
  const today = await businessToday();
  const [ings, prices, lots, last] = await Promise.all([
    prisma.ingredient.findMany({ where: { kind: 'SEMI', active: true }, orderBy: { name: 'asc' } }),
    lotPrices(),
    prisma.lot.groupBy({
      by: ['ingredientId'],
      where: { branchId, qtyRemaining: { gt: 0 } },
      _sum: { qtyRemaining: true },
    }),
    prisma.production.findMany({
      where: { branchId },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      distinct: ['ingredientId'],
    }),
  ]);
  const out: SemiDto[] = [];
  for (const ing of ings) {
    const r = await recipeAt(ing.id, today);
    const theo = r
      ? theoreticalUnitCost(
          r.items.map((i) => ({ ingredientId: i.ingredientId, qty: i.qty.toString() })),
          r.yieldQty.toString(),
          prices,
        )
      : null;
    out.push({
      ingredientId: ing.id,
      code: ing.code,
      name: ing.name,
      unit: ing.unit,
      recipe: r ? recipeDto(r) : null,
      theoreticalUnitCost: theo?.toString() ?? null,
      lastUnitCost: last.find((p) => p.ingredientId === ing.id)?.unitCost.toString() ?? null,
      onHand: s(lots.find((l) => l.ingredientId === ing.id)?._sum.qtyRemaining),
    });
  }
  return out;
}

async function semiOrThrow(id: number) {
  const ing = await prisma.ingredient.findUnique({ where: { id } });
  if (!ing) throw notFound('Nguyên liệu');
  if (ing.kind !== 'SEMI') throw badRequest(`${ing.name} không phải bán thành phẩm`);
  return ing;
}

export async function recipes(id: number) {
  await semiOrThrow(id);
  const rows = await prisma.semiRecipe.findMany({
    where: { ingredientId: id },
    include: recipeInclude,
    orderBy: { effectiveFrom: 'desc' },
  });
  return rows.map(recipeDto);
}

async function checkInputs(outputId: number, inputs: { ingredientId: number; qty: string }[]) {
  const ings = await prisma.ingredient.findMany({ where: { id: { in: inputs.map((i) => i.ingredientId) } } });
  if (ings.length !== new Set(inputs.map((i) => i.ingredientId)).size)
    throw badRequest('Nguyên liệu không tồn tại');
  const out = await semiOrThrow(outputId);
  const problem = productionProblem({
    outputKind: out.kind,
    outputId,
    inputs: inputs.map((i) => ({ ...i, kind: ings.find((x) => x.id === i.ingredientId)!.kind })),
  });
  if (problem) throw badRequest(problem);
  return out;
}

export async function saveRecipe(
  user: AuthUser,
  id: number,
  input: {
    effectiveFrom: string;
    yieldQty: string;
    note: string | null;
    items: { ingredientId: number; qty: string }[];
  },
) {
  await checkInputs(id, input.items);
  if (new Set(input.items.map((i) => i.ingredientId)).size !== input.items.length)
    throw badRequest('Mỗi nguyên liệu chỉ một dòng');
  const saved = await inTx(async (tx) => {
    const old = await tx.semiRecipe.findUnique({
      where: {
        ingredientId_effectiveFrom: { ingredientId: id, effectiveFrom: toDbDate(input.effectiveFrom) },
      },
    });
    if (old) await tx.semiRecipe.delete({ where: { id: old.id } });
    const r = await tx.semiRecipe.create({
      data: {
        ingredientId: id,
        effectiveFrom: toDbDate(input.effectiveFrom),
        yieldQty: input.yieldQty,
        note: input.note,
        items: { create: input.items.map((i) => ({ ingredientId: i.ingredientId, qty: i.qty })) },
      },
      include: recipeInclude,
    });
    await writeAudit(tx, {
      entity: 'semi_recipe',
      entityId: id,
      action: old ? 'UPDATE' : 'CREATE',
      after: input,
      userId: user.id,
    });
    return r;
  });
  return recipeDto(saved);
}

export async function plan(input: { ingredientId: number; qty: string; date: string }) {
  await semiOrThrow(input.ingredientId);
  const r = await recipeAt(input.ingredientId, input.date);
  if (!r) return { inputs: [], estimatedCost: null };
  const scaled = scaleRecipe(
    r.items.map((i) => ({ ingredientId: i.ingredientId, qty: i.qty.toString() })),
    r.yieldQty.toString(),
    input.qty,
  );
  const prices = await lotPrices();
  let cost = ZERO;
  let known = true;
  for (const l of scaled) {
    const p = prices.get(l.ingredientId);
    if (!p) known = false;
    else cost = cost.add(l.qty.mul(p));
  }
  return {
    inputs: scaled.map((l) => {
      const it = r.items.find((i) => i.ingredientId === l.ingredientId)!;
      return {
        ingredientId: l.ingredientId,
        name: it.ingredient.name,
        unit: it.ingredient.unit,
        qty: l.qty.toString(),
      };
    }),
    estimatedCost: known ? roundVnd(cost).toString() : null,
  };
}

// ---------------------------------------------------------------- productions

const productionInclude = {
  ingredient: true,
  lot: true,
} as const;
type ProductionRow = Prisma.ProductionGetPayload<{ include: typeof productionInclude }>;

async function toDtos(rows: ProductionRow[]): Promise<ProductionDto[]> {
  const [issues, users, locks] = await Promise.all([
    prisma.issueItem.findMany({
      where: { issueId: { in: rows.map((r) => r.issueId) } },
      include: { ingredient: true },
      orderBy: { id: 'asc' },
    }),
    prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } },
      select: { id: true, fullName: true },
    }),
    prisma.periodLock.findMany({ where: { branchId: await defaultBranchId() } }),
  ]);
  const locked = new Set(locks.map((l) => `${l.year}-${String(l.month).padStart(2, '0')}`));
  return rows.map((r) => {
    const date = fromDbDate(r.date);
    return {
      id: r.id,
      date,
      ingredientId: r.ingredientId,
      name: r.ingredient.name,
      unit: r.ingredient.unit,
      qty: s(r.qty),
      costTotal: s(r.costTotal),
      unitCost: s(r.unitCost),
      note: r.note,
      createdBy: users.find((u) => u.id === r.createdById)?.fullName ?? '',
      used: !!r.lot && !r.lot.qtyRemaining.equals(r.lot.qtyIn),
      locked: locked.has(date.slice(0, 7)),
      inputs: issues
        .filter((i) => i.issueId === r.issueId)
        .map((i) => ({
          ingredientId: i.ingredientId,
          name: i.ingredient.name,
          unit: i.ingredient.unit,
          qty: s(i.qty),
          cost: s(i.costTotal),
        })),
    };
  });
}

export async function list(month: string) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  const rows = await prisma.production.findMany({
    where: {
      branchId: await defaultBranchId(),
      date: { gte: toDbDate(`${month}-01`), lt: toDbDate(`${next}-01`) },
    },
    include: productionInclude,
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
  });
  return toDtos(rows);
}

export async function create(
  user: AuthUser,
  input: {
    date: string;
    ingredientId: number;
    qty: string;
    note: string | null;
    inputs: { ingredientId: number; qty: string }[];
  },
) {
  const out = await checkInputs(input.ingredientId, input.inputs);
  if (input.date > (await businessToday())) throw badRequest('Không ghi phiếu chế biến cho ngày tương lai');
  const branchId = await defaultBranchId();
  const id = await inTx(async (tx) => {
    await assertPeriodOpen(tx, input.date);
    // Cooking needs the ingredients in stock on that day (record the purchase first).
    const { issueId, costTotal } = await createIssueFromLots(tx, {
      branchId,
      date: input.date,
      reason: 'PRODUCTION',
      lines: input.inputs.map((i) => ({ ingredientId: i.ingredientId, qty: i.qty })),
      createdById: user.id,
      note: `Chế biến ${D(input.qty).toString()} ${out.unit} ${out.name}`,
      allowPending: false,
    });
    const unitCost = productionUnitCost(costTotal, input.qty);
    const p = await tx.production.create({
      data: {
        branchId,
        date: toDbDate(input.date),
        ingredientId: input.ingredientId,
        qty: input.qty,
        costTotal: costTotal.toString(),
        unitCost: unitCost.toString(),
        issueId,
        note: input.note,
        createdById: user.id,
      },
    });
    const lot = await tx.lot.create({
      data: {
        branchId,
        ingredientId: input.ingredientId,
        date: toDbDate(input.date),
        unitPrice: unitCost.toString(),
        qtyIn: input.qty,
        qtyRemaining: input.qty,
        productionId: p.id,
      },
    });
    // Dishes sold before this batch was recorded ("nợ kho") now get its real cost.
    await settlePendingWithLot(tx, lot.id);
    await writeAudit(tx, {
      entity: 'production',
      entityId: p.id,
      action: 'CREATE',
      after: input,
      userId: user.id,
    });
    return p.id;
  });
  const row = await prisma.production.findUniqueOrThrow({ where: { id }, include: productionInclude });
  return (await toDtos([row]))[0]!;
}

export async function remove(user: AuthUser, id: number, reason: string) {
  const p = await prisma.production.findUnique({ where: { id }, include: productionInclude });
  if (!p) throw notFound('Phiếu chế biến');
  const date = fromDbDate(p.date);
  if (user.role !== 'ADMIN' && (p.createdById !== user.id || date !== (await businessToday())))
    throw forbidden('Nhân viên chỉ xoá phiếu chế biến mình tạo trong ngày — các trường hợp khác cần ADMIN');
  await inTx(async (tx) => {
    await assertPeriodOpen(tx, date);
    if (p.lot) {
      await assertLotsUnused(tx, [p.lot.id]);
      await tx.lot.delete({ where: { id: p.lot.id } });
    }
    await deleteIssueRestoringLots(tx, p.issueId);
    await tx.production.delete({ where: { id } });
    await writeAudit(tx, {
      entity: 'production',
      entityId: id,
      action: 'DELETE',
      reason,
      before: { date, ingredientId: p.ingredientId, qty: s(p.qty), costTotal: s(p.costTotal) },
      userId: user.id,
    });
  });
  return { ok: true as const };
}
