import { prisma, inTx } from '../../core/db';
import { writeAudit } from '../../core/audit';
import { defaultBranchId } from '../../core/branch';
import { assertPeriodOpen } from '../../core/period-lock';
import { sum } from '../../domain/money';
import type { OverheadMonth } from '../../contracts/overheads.contract';

export async function year(y: number): Promise<OverheadMonth[]> {
  const branchId = await defaultBranchId();
  const [rows, locks] = await Promise.all([
    prisma.overheadExpense.findMany({ where: { branchId, year: y }, orderBy: { id: 'asc' } }),
    prisma.periodLock.findMany({ where: { branchId, year: y } }),
  ]);
  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const lines = rows
      .filter((r) => r.month === month)
      .map((r) => ({ category: r.category, amount: r.amount.toString(), note: r.note }));
    return {
      year: y,
      month,
      lines,
      total: sum(lines.map((l) => l.amount)).toString(),
      locked: locks.some((l) => l.month === month),
    };
  });
}

export async function saveMonth(
  userId: number,
  y: number,
  m: number,
  lines: { category: string; amount: string; note: string | null }[],
) {
  const branchId = await defaultBranchId();
  await inTx(async (tx) => {
    await assertPeriodOpen(tx, `${y}-${String(m).padStart(2, '0')}-01`);
    const before = await tx.overheadExpense.findMany({ where: { branchId, year: y, month: m } });
    await tx.overheadExpense.deleteMany({ where: { branchId, year: y, month: m } });
    const kept = lines.filter((l) => Number(l.amount) > 0);
    if (kept.length)
      await tx.overheadExpense.createMany({ data: kept.map((l) => ({ ...l, branchId, year: y, month: m })) });
    await writeAudit(tx, {
      entity: 'overhead',
      entityId: `${y}-${m}`,
      action: 'SAVE',
      before,
      after: kept,
      userId,
    });
  });
  return (await year(y))[m - 1]!;
}
