import type { Db } from './db';
import { conflict } from './errors';
import { defaultBranchId } from './branch';

/** Throw 409 when `isoDate` (YYYY-MM-DD) falls in a locked month. Call in every write path. */
export async function assertPeriodOpen(db: Db, isoDate: string): Promise<void> {
  const [y, m] = isoDate.split('-').map(Number) as [number, number];
  const lock = await db.periodLock.findUnique({
    where: { branchId_year_month: { branchId: await defaultBranchId(), year: y, month: m } },
  });
  if (lock) throw conflict('PERIOD_LOCKED', `Tháng ${m}/${y} đã khoá sổ, không thể thay đổi chứng từ`);
}
