// Staff: employees, shift templates, schedule & attendance (also self check-in at the till).
import type { Attendance, Employee, Shift } from '@prisma/client';
import type { z } from 'zod';
import { prisma, inTx, type Db, type Tx } from '../../core/db';
import { badRequest, conflict, notFound } from '../../core/errors';
import { writeAudit } from '../../core/audit';
import { assertPeriodOpen } from '../../core/period-lock';
import { defaultBranchId } from '../../core/branch';
import type { AuthUser } from '../../core/auth';
import type {
  AttendanceDto,
  EmployeeDto,
  MyAttendance,
  ShiftDto,
  attendanceInput,
  employeeInput,
  shiftInput,
} from '../../contracts/staff.contract';
import { fromDbDate, toDbDate } from '../../domain/business-date';
import { clockToInstant, instantToClock, shiftHours, workedHours } from '../../domain/staff/payroll';
import { businessToday, getSettings } from '../settings/settings.service';

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------- employees

async function employeeDtos(db: Db, rows: Employee[]): Promise<EmployeeDto[]> {
  const ids = rows.flatMap((e) => (e.userId === null ? [] : [e.userId]));
  const users = ids.length
    ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } })
    : [];
  return rows.map((e) => ({
    id: e.id,
    name: e.name,
    phone: e.phone,
    position: e.position,
    payType: e.payType,
    rate: e.rate.toString(),
    userId: e.userId,
    userName: users.find((u) => u.id === e.userId)?.fullName ?? null,
    active: e.active,
  }));
}

export async function employees() {
  return employeeDtos(
    prisma,
    await prisma.employee.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }] }),
  );
}

export async function saveEmployee(userId: number, id: number | null, input: z.infer<typeof employeeInput>) {
  const row = await inTx(async (tx) => {
    if (input.userId !== null) {
      if (!(await tx.user.findUnique({ where: { id: input.userId } }))) throw notFound('Tài khoản');
      const other = await tx.employee.findFirst({
        where: { userId: input.userId, ...(id ? { id: { not: id } } : {}) },
      });
      if (other) throw conflict('DUPLICATE', `Tài khoản này đã gắn với nhân viên "${other.name}"`);
    }
    const before = id ? await tx.employee.findUnique({ where: { id } }) : null;
    if (id && !before) throw notFound('Nhân viên');
    const row = id
      ? await tx.employee.update({ where: { id }, data: input })
      : await tx.employee.create({ data: input });
    await writeAudit(tx, {
      entity: 'employee',
      entityId: row.id,
      action: id ? 'UPDATE' : 'CREATE',
      before,
      after: input,
      userId,
    });
    return row;
  });
  return (await employeeDtos(prisma, [row]))[0]!;
}

// ---------------------------------------------------------------- shifts

const shiftDto = (s: Shift): ShiftDto => ({
  id: s.id,
  name: s.name,
  start: s.start,
  end: s.end,
  sort: s.sort,
  active: s.active,
  hours: shiftHours(s.start, s.end),
});

export async function shifts(db: Db = prisma) {
  return (await db.shift.findMany({ orderBy: [{ sort: 'asc' }, { start: 'asc' }] })).map(shiftDto);
}

export async function saveShift(userId: number, id: number | null, input: z.infer<typeof shiftInput>) {
  if (input.start === input.end) throw badRequest('Giờ kết thúc phải khác giờ bắt đầu');
  const row = await inTx(async (tx) => {
    const before = id ? await tx.shift.findUnique({ where: { id } }) : null;
    if (id && !before) throw notFound('Ca làm');
    const row = id
      ? await tx.shift.update({ where: { id }, data: input })
      : await tx.shift.create({ data: input });
    await writeAudit(tx, {
      entity: 'shift',
      entityId: row.id,
      action: id ? 'UPDATE' : 'CREATE',
      before,
      after: input,
      userId,
    });
    return row;
  });
  return shiftDto(row);
}

// ---------------------------------------------------------------- attendance

const toDto = (a: Attendance): AttendanceDto => ({
  employeeId: a.employeeId,
  date: fromDbDate(a.date),
  shiftId: a.shiftId,
  checkIn: a.checkIn ? instantToClock(a.checkIn) : null,
  checkOut: a.checkOut ? instantToClock(a.checkOut) : null,
  note: a.note,
  hours: workedHours(a.checkIn, a.checkOut).toString(),
});

/** Check-in / check-out instants from clock times; a check-out not after the check-in is the next day. */
function instants(date: string, checkIn: string | null, checkOut: string | null, dayStart: string) {
  const inAt = checkIn ? clockToInstant(date, checkIn, dayStart) : null;
  let outAt = checkOut ? clockToInstant(date, checkOut, dayStart) : null;
  if (inAt && outAt && outAt.getTime() === inAt.getTime()) throw badRequest('Giờ ra trùng giờ vào');
  if (inAt && outAt && outAt < inAt) outAt = new Date(outAt.getTime() + DAY_MS);
  return { checkIn: inAt, checkOut: outAt };
}

/** Months ("YYYY-MM") whose payroll is closed: their attendance no longer changes. */
async function closedMonths(db: Db, from: string, to: string) {
  const branchId = await defaultBranchId();
  const rows = await db.payroll.findMany({ where: { branchId, status: 'CLOSED' } });
  return rows
    .map((p) => `${p.year}-${String(p.month).padStart(2, '0')}`)
    .filter((m) => m >= from.slice(0, 7) && m <= to.slice(0, 7));
}

/** Attendance of a day can change: month not locked, payroll not closed. */
export async function assertAttendanceOpen(db: Db, date: string) {
  await assertPeriodOpen(db, date);
  if ((await closedMonths(db, date, date)).length)
    throw conflict(
      'PAYROLL_CLOSED',
      `Bảng lương tháng ${Number(date.slice(5, 7))} đã chốt — mở lại để sửa chấm công`,
    );
}

export async function attendance(from: string, to: string) {
  const range = { gte: toDbDate(from), lte: toDbDate(to) };
  const rows = await prisma.attendance.findMany({ where: { date: range }, orderBy: [{ date: 'asc' }] });
  const used = new Set(rows.map((r) => r.employeeId));
  const people = await prisma.employee.findMany({
    where: { OR: [{ active: true }, { id: { in: [...used] } }] },
    orderBy: { name: 'asc' },
  });
  return {
    employees: people.map((e) => ({ id: e.id, name: e.name, position: e.position })),
    shifts: await shifts(),
    rows: rows.map(toDto),
    closedMonths: await closedMonths(prisma, from, to),
  };
}

export async function saveAttendance(userId: number, input: z.infer<typeof attendanceInput>) {
  const { business_day_start: dayStart } = await getSettings();
  const times = instants(input.date, input.checkIn, input.checkOut, dayStart);
  const row = await inTx(async (tx) => {
    await assertAttendanceOpen(tx, input.date);
    if (!(await tx.employee.findUnique({ where: { id: input.employeeId } }))) throw notFound('Nhân viên');
    const key = { employeeId_date: { employeeId: input.employeeId, date: toDbDate(input.date) } };
    const before = await tx.attendance.findUnique({ where: key });
    const empty = input.shiftId === null && !input.checkIn && !input.checkOut && !input.note;
    let row: Attendance | null = null;
    if (empty) {
      if (before) await tx.attendance.delete({ where: key });
    } else {
      const data = { shiftId: input.shiftId, ...times, note: input.note };
      row = await tx.attendance.upsert({
        where: key,
        create: { employeeId: input.employeeId, date: toDbDate(input.date), ...data },
        update: data,
      });
    }
    await writeAudit(tx, {
      entity: 'attendance',
      entityId: `${input.employeeId}-${input.date}`,
      action: 'SAVE',
      before: before && toDto(before),
      after: row && toDto(row),
      userId,
    });
    return row;
  });
  return { row: row && toDto(row) };
}

/** "Đủ ca": scheduled days without any clock time get the shift's hours. */
export async function fillAttendance(userId: number, from: string, to: string) {
  const { business_day_start: dayStart } = await getSettings();
  const closed = new Set(await closedMonths(prisma, from, to));
  const rows = await prisma.attendance.findMany({
    where: {
      date: { gte: toDbDate(from), lte: toDbDate(to) },
      shiftId: { not: null },
      checkIn: null,
      checkOut: null,
    },
    include: { shift: true },
  });
  let filled = 0;
  await inTx(async (tx) => {
    for (const r of rows) {
      const date = fromDbDate(r.date);
      if (closed.has(date.slice(0, 7))) continue;
      await assertPeriodOpen(tx, date);
      const times = instants(date, r.shift!.start, r.shift!.end, dayStart);
      await tx.attendance.update({ where: { id: r.id }, data: times });
      filled += 1;
    }
    if (filled)
      await writeAudit(tx, {
        entity: 'attendance',
        entityId: `${from}..${to}`,
        action: 'FILL',
        after: { filled },
        userId,
      });
  });
  return { filled };
}

// ---------------------------------------------------------------- self check-in

async function myRow(tx: Db, user: AuthUser) {
  const employee = await tx.employee.findUnique({ where: { userId: user.id } });
  const today = await businessToday(tx);
  if (!employee?.active) return { employee: null, today, row: null };
  const row = await tx.attendance.findUnique({
    where: { employeeId_date: { employeeId: employee.id, date: toDbDate(today) } },
    include: { shift: true },
  });
  return { employee, today, row };
}

export async function me(user: AuthUser, db: Db = prisma): Promise<MyAttendance> {
  const { employee, today, row } = await myRow(db, user);
  return {
    employee: employee && { id: employee.id, name: employee.name },
    today,
    row: row && toDto(row),
    shift: row?.shift ? shiftDto(row.shift) : null,
  };
}

export async function clock(user: AuthUser, action: 'IN' | 'OUT') {
  await inTx(async (tx: Tx) => {
    const { employee, today, row } = await myRow(tx, user);
    if (!employee)
      throw badRequest('Tài khoản chưa gắn với nhân viên nào — nhờ chủ quán gắn ở màn hình Nhân viên');
    await assertAttendanceOpen(tx, today);
    const now = new Date();
    if (action === 'IN') {
      if (row?.checkIn) throw badRequest(`Đã vào ca lúc ${instantToClock(row.checkIn)}`);
      await tx.attendance.upsert({
        where: { employeeId_date: { employeeId: employee.id, date: toDbDate(today) } },
        create: { employeeId: employee.id, date: toDbDate(today), checkIn: now },
        update: { checkIn: now },
      });
    } else {
      if (!row?.checkIn) throw badRequest('Chưa vào ca hôm nay');
      if (row.checkOut) throw badRequest(`Đã ra ca lúc ${instantToClock(row.checkOut)}`);
      await tx.attendance.update({ where: { id: row.id }, data: { checkOut: now } });
    }
    await writeAudit(tx, {
      entity: 'attendance',
      entityId: `${employee.id}-${today}`,
      action: action === 'IN' ? 'CHECK_IN' : 'CHECK_OUT',
      userId: user.id,
    });
  });
  return me(user);
}
