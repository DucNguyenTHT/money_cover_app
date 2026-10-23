// Monthly payroll: hours from attendance × rate (or the monthly wage) + bonus − deduction − advances.
// Closing it writes the month's wages to overheads; paying a line in cash (and cash advances) goes to the cash book.
import type { Employee, PayrollLine, SalaryAdvance } from '@prisma/client';
import { prisma, inTx, type Db, type Tx } from '../../core/db';
import { badRequest, conflict, notFound } from '../../core/errors';
import { writeAudit } from '../../core/audit';
import { assertPeriodOpen } from '../../core/period-lock';
import { defaultBranchId } from '../../core/branch';
import type { AuthUser } from '../../core/auth';
import type {
  PayrollDto,
  PayrollLineDto,
  SalaryAdvanceDto,
  salaryAdvanceInput,
} from '../../contracts/staff.contract';
import type { z } from 'zod';
import { fromDbDate, toDbDate } from '../../domain/business-date';
import { D, sum, type Decimal } from '../../domain/money';
import { monthPay, workedHours } from '../../domain/staff/payroll';
import * as cash from '../cash/cash.service';
import { businessToday } from '../settings/settings.service';

/** Overhead category the payroll writes to. */
export const SALARY_CATEGORY = 'Lương';
const marker = (y: number, m: number) => `Theo bảng lương tháng ${m}/${y}`;
const first = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}-01`;
const monthRange = (y: number, m: number) => ({
  gte: toDbDate(first(y, m)),
  lt: toDbDate(m === 12 ? first(y + 1, 1) : first(y, m + 1)),
});

async function userNames(db: Db, ids: (number | null)[]) {
  const wanted = [...new Set(ids.filter((x): x is number => x !== null))];
  const rows = wanted.length
    ? await db.user.findMany({ where: { id: { in: wanted } }, select: { id: true, fullName: true } })
    : [];
  return new Map(rows.map((u) => [u.id, u.fullName]));
}

const findPayroll = async (db: Db, y: number, m: number) =>
  db.payroll.findUnique({
    where: { branchId_year_month: { branchId: await defaultBranchId(), year: y, month: m } },
    include: { lines: true },
  });

/** The overhead line written by this payroll (found again by its note when Chi phí chung was re-saved). */
async function overheadLine(db: Db, y: number, m: number, linkedId: number | null) {
  const branchId = await defaultBranchId();
  const byId = linkedId ? await db.overheadExpense.findUnique({ where: { id: linkedId } }) : null;
  if (byId && byId.note === marker(y, m) && byId.year === y && byId.month === m) return byId;
  return db.overheadExpense.findFirst({
    where: { branchId, year: y, month: m, category: SALARY_CATEGORY, note: marker(y, m) },
  });
}

/** Live figures of the month for every employee concerned (active, or with hours / advances / a saved line). */
async function liveLines(db: Db, y: number, m: number, saved: PayrollLine[]) {
  const range = monthRange(y, m);
  const [att, adv] = await Promise.all([
    db.attendance.findMany({ where: { date: range } }),
    db.salaryAdvance.findMany({ where: { date: range, cancelledAt: null } }),
  ]);
  const ids = new Set([
    ...att.map((a) => a.employeeId),
    ...adv.map((a) => a.employeeId),
    ...saved.map((l) => l.employeeId),
  ]);
  const people = await db.employee.findMany({
    where: { OR: [{ active: true }, { id: { in: [...ids] } }] },
    orderBy: { name: 'asc' },
  });
  return people.map((e) => {
    const mine = att.filter((a) => a.employeeId === e.id);
    const worked = mine.map((a) => workedHours(a.checkIn, a.checkOut));
    const line = saved.find((l) => l.employeeId === e.id);
    return {
      employee: e,
      line,
      payType: e.payType,
      rate: D(e.rate.toString()),
      days: worked.filter((h) => h.gt(0)).length,
      hours: sum(worked),
      bonus: D(line?.bonus.toString() ?? 0),
      deduction: D(line?.deduction.toString() ?? 0),
      advance: sum(adv.filter((a) => a.employeeId === e.id).map((a) => a.amount.toString())),
      note: line?.note ?? null,
    };
  });
}
type Live = Awaited<ReturnType<typeof liveLines>>[number];

function lineDto(
  e: Pick<Employee, 'id' | 'name' | 'position'>,
  v: {
    lineId: number | null;
    payType: Employee['payType'];
    rate: Decimal;
    days: number;
    hours: Decimal;
    bonus: Decimal;
    deduction: Decimal;
    advance: Decimal;
    note: string | null;
    paidAt: Date | null;
    paidMethod: string | null;
  },
): PayrollLineDto {
  const pay = monthPay(v);
  return {
    lineId: v.lineId,
    employeeId: e.id,
    name: e.name,
    position: e.position,
    payType: v.payType,
    rate: v.rate.toString(),
    days: v.days,
    hours: v.hours.toString(),
    basePay: pay.basePay.toString(),
    bonus: v.bonus.toString(),
    deduction: v.deduction.toString(),
    advance: v.advance.toString(),
    gross: pay.gross.toString(),
    toPay: pay.toPay.toString(),
    note: v.note,
    paidAt: v.paidAt?.toISOString() ?? null,
    paidMethod: v.paidMethod,
  };
}

const liveDto = (l: Live) =>
  lineDto(l.employee, { ...l, lineId: l.line?.id ?? null, paidAt: null, paidMethod: null });

export async function get(y: number, m: number, db: Db = prisma): Promise<PayrollDto> {
  const branchId = await defaultBranchId();
  const p = await findPayroll(db, y, m);
  const closed = p?.status === 'CLOSED';
  let lines: PayrollLineDto[];
  if (closed) {
    const people = await db.employee.findMany({ where: { id: { in: p.lines.map((l) => l.employeeId) } } });
    const days = await db.attendance.findMany({ where: { date: monthRange(y, m) } });
    lines = p.lines
      .map((l) => {
        const e = people.find((x) => x.id === l.employeeId)!;
        return lineDto(e, {
          lineId: l.id,
          payType: l.payType,
          rate: D(l.rate.toString()),
          days: days.filter((a) => a.employeeId === e.id && workedHours(a.checkIn, a.checkOut).gt(0)).length,
          hours: D(l.hours.toString()),
          bonus: D(l.bonus.toString()),
          deduction: D(l.deduction.toString()),
          advance: D(l.advance.toString()),
          note: l.note,
          paidAt: l.paidAt,
          paidMethod: l.paidMethod,
        });
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  } else {
    lines = (await liveLines(db, y, m, p?.lines ?? [])).map(liveDto);
  }
  const advances = await db.salaryAdvance.findMany({
    where: { date: monthRange(y, m) },
    include: { employee: true },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
  });
  const who = await userNames(db, [...advances.map((a) => a.createdById), p?.closedById ?? null]);
  const overhead = await overheadLine(db, y, m, p?.overheadExpenseId ?? null);
  const salaryLines = await db.overheadExpense.findMany({
    where: { branchId, year: y, month: m, category: SALARY_CATEGORY },
  });
  const lock = await db.periodLock.findUnique({
    where: { branchId_year_month: { branchId, year: y, month: m } },
  });
  return {
    year: y,
    month: m,
    status: p?.status ?? 'DRAFT',
    closedAt: closed ? (p.closedAt?.toISOString() ?? null) : null,
    closedByName: closed && p.closedById ? (who.get(p.closedById) ?? null) : null,
    locked: !!lock,
    lines,
    advances: advances.map((a) => advanceDto(a, who)),
    gross: sum(lines.map((l) => l.gross)).toString(),
    toPay: sum(lines.map((l) => l.toPay)).toString(),
    overheadAmount: closed && overhead ? overhead.amount.toString() : null,
    otherSalaryOverhead: sum(
      salaryLines.filter((l) => l.id !== overhead?.id).map((l) => l.amount.toString()),
    ).toString(),
  };
}

const advanceDto = (
  a: SalaryAdvance & { employee: Employee },
  who: Map<number, string>,
): SalaryAdvanceDto => ({
  id: a.id,
  employeeId: a.employeeId,
  employeeName: a.employee.name,
  date: fromDbDate(a.date),
  amount: a.amount.toString(),
  method: a.method as 'CASH' | 'TRANSFER',
  note: a.note,
  createdByName: who.get(a.createdById) ?? '',
  cancelled: !!a.cancelledAt,
  cancelReason: a.cancelReason,
});

async function assertDraft(db: Db, y: number, m: number) {
  await assertPeriodOpen(db, first(y, m));
  const p = await findPayroll(db, y, m);
  if (p?.status === 'CLOSED')
    throw conflict('PAYROLL_CLOSED', `Bảng lương tháng ${m}/${y} đã chốt — mở lại để sửa`);
  return p;
}

/** Write the live figures (with these adjustments) as the month's lines. */
async function writeLines(
  tx: Tx,
  y: number,
  m: number,
  adjust: Map<number, { bonus: string; deduction: string; note: string | null }>,
) {
  const p =
    (await findPayroll(tx, y, m)) ??
    (await tx.payroll.create({
      data: { branchId: await defaultBranchId(), year: y, month: m },
      include: { lines: true },
    }));
  const live = await liveLines(tx, y, m, p.lines);
  for (const l of live) {
    const a = adjust.get(l.employee.id);
    const bonus = a ? D(a.bonus) : l.bonus;
    const deduction = a ? D(a.deduction) : l.deduction;
    const note = a ? a.note : l.note;
    const pay = monthPay({ ...l, bonus, deduction });
    const empty = pay.basePay.isZero() && bonus.isZero() && deduction.isZero() && l.advance.isZero() && !note;
    const key = { payrollId_employeeId: { payrollId: p.id, employeeId: l.employee.id } };
    if (empty) {
      await tx.payrollLine.deleteMany({ where: { payrollId: p.id, employeeId: l.employee.id } });
      continue;
    }
    const data = {
      payType: l.payType,
      hours: l.hours.toString(),
      rate: l.rate.toString(),
      basePay: pay.basePay.toString(),
      bonus: bonus.toString(),
      deduction: deduction.toString(),
      advance: l.advance.toString(),
      note,
    };
    await tx.payrollLine.upsert({
      where: key,
      create: { payrollId: p.id, employeeId: l.employee.id, ...data },
      update: data,
    });
  }
  return p;
}

export async function save(
  userId: number,
  y: number,
  m: number,
  lines: { employeeId: number; bonus: string; deduction: string; note: string | null }[],
) {
  await inTx(async (tx) => {
    await assertDraft(tx, y, m);
    await writeLines(tx, y, m, new Map(lines.map((l) => [l.employeeId, l])));
    await writeAudit(tx, { entity: 'payroll', entityId: `${y}-${m}`, action: 'SAVE', after: lines, userId });
  });
  return get(y, m);
}

export async function close(userId: number, y: number, m: number) {
  await inTx(async (tx) => {
    await assertDraft(tx, y, m);
    const p = await writeLines(tx, y, m, new Map());
    const saved = await tx.payrollLine.findMany({ where: { payrollId: p.id } });
    // The month's wage cost (advances are part of it, paid early).
    const total = sum(
      saved.map((l) => D(l.basePay.toString()).add(l.bonus.toString()).sub(l.deduction.toString())),
    );
    const branchId = await defaultBranchId();
    const existing = await overheadLine(tx, y, m, p.overheadExpenseId);
    let overheadId: number | null = null;
    if (total.gt(0)) {
      overheadId = existing
        ? (
            await tx.overheadExpense.update({
              where: { id: existing.id },
              data: { amount: total.toString() },
            })
          ).id
        : (
            await tx.overheadExpense.create({
              data: {
                branchId,
                year: y,
                month: m,
                category: SALARY_CATEGORY,
                amount: total.toString(),
                note: marker(y, m),
              },
            })
          ).id;
    } else if (existing) await tx.overheadExpense.delete({ where: { id: existing.id } });
    await tx.payroll.update({
      where: { id: p.id },
      data: { status: 'CLOSED', closedAt: new Date(), closedById: userId, overheadExpenseId: overheadId },
    });
    await writeAudit(tx, {
      entity: 'payroll',
      entityId: `${y}-${m}`,
      action: 'CLOSE',
      after: { total: total.toString() },
      userId,
    });
  });
  return get(y, m);
}

export async function reopen(userId: number, y: number, m: number, reason: string) {
  await inTx(async (tx) => {
    await assertPeriodOpen(tx, first(y, m));
    const p = await findPayroll(tx, y, m);
    if (p?.status !== 'CLOSED') throw badRequest('Bảng lương chưa chốt');
    if (p.lines.some((l) => l.paidAt))
      throw badRequest('Đã trả lương cho một số người — huỷ các lần trả trước khi mở lại');
    const line = await overheadLine(tx, y, m, p.overheadExpenseId);
    if (line) await tx.overheadExpense.delete({ where: { id: line.id } });
    await tx.payroll.update({
      where: { id: p.id },
      data: { status: 'DRAFT', closedAt: null, closedById: null, overheadExpenseId: null },
    });
    await writeAudit(tx, { entity: 'payroll', entityId: `${y}-${m}`, action: 'REOPEN', reason, userId });
  });
  return get(y, m);
}

async function closedLine(tx: Tx, lineId: number) {
  const line = await tx.payrollLine.findUnique({
    where: { id: lineId },
    include: { payroll: true, employee: true },
  });
  if (!line) throw notFound('Dòng bảng lương');
  if (line.payroll.status !== 'CLOSED') throw badRequest('Chốt bảng lương trước khi trả');
  return line;
}

export async function payLine(user: AuthUser, lineId: number, method: 'CASH' | 'TRANSFER', date: string) {
  const { year, month } = await inTx(async (tx) => {
    const line = await closedLine(tx, lineId);
    if (line.paidAt) throw badRequest(`Đã trả lương cho ${line.employee.name}`);
    const { toPay } = monthPay({
      payType: line.payType,
      rate: line.rate.toString(),
      hours: line.hours.toString(),
      bonus: line.bonus.toString(),
      deduction: line.deduction.toString(),
      advance: line.advance.toString(),
    });
    const { year, month } = line.payroll;
    if (method === 'CASH' && toPay.gt(0))
      await cash.addTx(
        tx,
        {
          businessDate: date,
          direction: 'OUT',
          category: 'Trả lương',
          amount: toPay.toString(),
          note: `${line.employee.name} · lương tháng ${month}/${year}`,
          source: 'PAYROLL',
          sourceId: line.id,
        },
        user.id,
      );
    else if (date > (await businessToday(tx))) throw badRequest('Không ghi trả lương cho ngày tương lai');
    await tx.payrollLine.update({ where: { id: line.id }, data: { paidAt: new Date(), paidMethod: method } });
    await writeAudit(tx, {
      entity: 'payroll_line',
      entityId: line.id,
      action: 'PAY',
      after: { method, date, amount: toPay.toString() },
      userId: user.id,
    });
    return line.payroll;
  });
  return get(year, month);
}

export async function unpayLine(user: AuthUser, lineId: number, reason: string) {
  const { year, month } = await inTx(async (tx) => {
    const line = await closedLine(tx, lineId);
    if (!line.paidAt) throw badRequest('Dòng này chưa trả');
    await tx.payrollLine.update({ where: { id: line.id }, data: { paidAt: null, paidMethod: null } });
    await cash.cancelBySourceTx(tx, 'PAYROLL', line.id, reason, user.id);
    await writeAudit(tx, {
      entity: 'payroll_line',
      entityId: line.id,
      action: 'UNPAY',
      reason,
      userId: user.id,
    });
    return line.payroll;
  });
  return get(year, month);
}

// ---------------------------------------------------------------- advances

const monthOf = (date: string) => [Number(date.slice(0, 4)), Number(date.slice(5, 7))] as const;

export async function createAdvance(user: AuthUser, input: z.infer<typeof salaryAdvanceInput>) {
  const id = await inTx(async (tx) => {
    const e = await tx.employee.findUnique({ where: { id: input.employeeId } });
    if (!e) throw notFound('Nhân viên');
    if (input.date > (await businessToday(tx))) throw badRequest('Không ghi tạm ứng cho ngày tương lai');
    await assertDraft(tx, ...monthOf(input.date));
    const a = await tx.salaryAdvance.create({
      data: { ...input, date: toDbDate(input.date), createdById: user.id },
    });
    if (input.method === 'CASH')
      await cash.addTx(
        tx,
        {
          businessDate: input.date,
          direction: 'OUT',
          category: 'Tạm ứng lương',
          amount: input.amount,
          note: [e.name, input.note].filter(Boolean).join(' · '),
          source: 'ADVANCE',
          sourceId: a.id,
        },
        user.id,
      );
    await writeAudit(tx, {
      entity: 'salary_advance',
      entityId: a.id,
      action: 'CREATE',
      after: input,
      userId: user.id,
    });
    return a.id;
  });
  return oneAdvance(id);
}

export async function cancelAdvance(user: AuthUser, id: number, reason: string) {
  await inTx(async (tx) => {
    const a = await tx.salaryAdvance.findUnique({ where: { id } });
    if (!a) throw notFound('Khoản tạm ứng');
    if (a.cancelledAt) throw badRequest('Khoản tạm ứng này đã huỷ');
    await assertDraft(tx, ...monthOf(fromDbDate(a.date)));
    await tx.salaryAdvance.update({
      where: { id },
      data: { cancelledAt: new Date(), cancelledById: user.id, cancelReason: reason },
    });
    await cash.cancelBySourceTx(tx, 'ADVANCE', id, reason, user.id);
    await writeAudit(tx, {
      entity: 'salary_advance',
      entityId: id,
      action: 'CANCEL',
      reason,
      userId: user.id,
    });
  });
  return oneAdvance(id);
}

async function oneAdvance(id: number) {
  const a = await prisma.salaryAdvance.findUniqueOrThrow({ where: { id }, include: { employee: true } });
  return advanceDto(a, await userNames(prisma, [a.createdById]));
}
