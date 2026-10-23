import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/core/db';
import { businessToday } from '../../src/modules/settings/settings.service';
import type { MyAttendance, PayrollDto } from '../../src/contracts/staff.contract';
import { makeUser, resetDb, startServer, stopServer } from '../helpers/harness';

beforeAll(startServer);
afterAll(stopServer);
beforeEach(resetDb);

type Client = Awaited<ReturnType<typeof makeUser>>['client'];

const employee = (c: Client, over: Record<string, unknown>) =>
  c.staff.createEmployee({
    body: {
      name: 'Nhân viên',
      phone: null,
      position: null,
      payType: 'HOURLY',
      rate: '50000',
      userId: null,
      active: true,
      ...over,
    } as never,
  });

describe('attendance (chấm công)', () => {
  it('schedules shifts, fills the scheduled days, counts hours past midnight', async () => {
    const { client } = await makeUser({ username: 'chu', role: 'ADMIN' });
    const shift = (
      await client.staff.createShift({
        body: { name: 'Ca sáng', start: '06:00', end: '14:00', sort: 1, active: true },
      })
    ).body as { id: number; hours: number };
    expect(shift.hours).toBe(8);
    const a = (await employee(client, { name: 'An' })).body as { id: number };

    const day = (n: number) => `2026-09-${String(n).padStart(2, '0')}`;
    const save = (date: string, over: Record<string, unknown>) =>
      client.staff.saveAttendance({
        body: {
          employeeId: a.id,
          date,
          shiftId: null,
          checkIn: null,
          checkOut: null,
          note: null,
          ...over,
        } as never,
      });
    expect(
      (await save(day(1), { shiftId: shift.id, checkIn: '06:00', checkOut: '13:30' })).body,
    ).toMatchObject({
      row: { hours: '7.5', checkIn: '06:00', checkOut: '13:30' },
    });
    await save(day(2), { shiftId: shift.id });
    // Business day starts at 04:00: 02:00 is the next morning.
    expect((await save(day(3), { checkIn: '22:00', checkOut: '02:00' })).body).toMatchObject({
      row: { hours: '4' },
    });
    expect((await save(day(4), { note: 'nghỉ phép' })).status).toBe(200);
    expect((await save(day(4), {})).body).toEqual({ row: null });

    const filled = await client.staff.fillAttendance({ body: { from: day(1), to: day(7) } });
    expect(filled.body).toEqual({ filled: 1 });
    const week = (await client.staff.attendance({ query: { from: day(1), to: day(7) } })).body as {
      rows: { date: string; hours: string }[];
    };
    expect(week.rows.map((r) => [r.date, r.hours])).toEqual([
      [day(1), '7.5'],
      [day(2), '8'],
      [day(3), '4'],
    ]);
  });

  it('a linked login checks in and out at the till', async () => {
    const admin = await makeUser({ username: 'chu', role: 'ADMIN' });
    const staff = await makeUser({ username: 'thungan', role: 'STAFF' });
    const cook = await makeUser({ username: 'bep', role: 'KITCHEN' });
    await employee(admin.client, { name: 'Thu Ngân', userId: staff.user.id });

    const none = (await cook.client.staff.myAttendance()).body as MyAttendance;
    expect(none.employee).toBeNull();
    expect((await cook.client.staff.clock({ body: { action: 'IN' } })).status).toBe(400);

    const before = (await staff.client.staff.myAttendance()).body as MyAttendance;
    expect(before).toMatchObject({ employee: { name: 'Thu Ngân' }, row: null });
    expect((await staff.client.staff.clock({ body: { action: 'OUT' } })).status).toBe(400);
    const inside = (await staff.client.staff.clock({ body: { action: 'IN' } })).body as MyAttendance;
    expect(inside.row?.checkIn).toMatch(/^\d{2}:\d{2}$/);
    expect((await staff.client.staff.clock({ body: { action: 'IN' } })).status).toBe(400);
    const out = (await staff.client.staff.clock({ body: { action: 'OUT' } })).body as MyAttendance;
    expect(out.row?.checkOut).toMatch(/^\d{2}:\d{2}$/);

    // Linking the same login twice is refused; staff cannot open the payroll.
    expect((await employee(admin.client, { name: 'Trùng', userId: staff.user.id })).status).toBe(409);
    expect((await staff.client.staff.payroll({ params: { year: 2026, month: 9 } })).status).toBe(403);
  });
});

describe('payroll (bảng lương)', () => {
  it('hours × rate or the monthly wage, advances deducted; closing writes overheads; paying in cash hits the till', async () => {
    const { client } = await makeUser({ username: 'chu', role: 'ADMIN' });
    const today = await businessToday();
    const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
    const params = { year: y, month: m };
    const first = `${today.slice(0, 7)}-01`;

    const an = (await employee(client, { name: 'An', rate: '50000' })).body as { id: number };
    const binh = (await employee(client, { name: 'Bình', payType: 'MONTHLY', rate: '7000000' })).body as {
      id: number;
    };
    await client.staff.saveAttendance({
      body: {
        employeeId: an.id,
        date: first,
        shiftId: null,
        checkIn: '08:00',
        checkOut: '17:45',
        note: null,
      },
    });
    await client.staff.createAdvance({
      body: { employeeId: an.id, date: today, amount: '200000', method: 'CASH', note: null },
    });
    const transfer = (
      await client.staff.createAdvance({
        body: {
          employeeId: binh.id,
          date: today,
          amount: '1000000',
          method: 'TRANSFER',
          note: 'ứng giữa tháng',
        },
      })
    ).body as { id: number };
    const book = (await client.cash.list({ query: { from: today, to: today } })).body as {
      entries: { category: string; amount: string; source: string | null }[];
    };
    expect(book.entries).toMatchObject([{ category: 'Tạm ứng lương', amount: '200000', source: 'ADVANCE' }]);

    let p = (await client.staff.payroll({ params })).body as PayrollDto;
    const line = (name: string) => p.lines.find((l) => l.name === name)!;
    expect(line('An')).toMatchObject({
      days: 1,
      hours: '9.75',
      basePay: '487500',
      advance: '200000',
      toPay: '287500',
    });
    expect(line('Bình')).toMatchObject({ basePay: '7000000', advance: '1000000', toPay: '6000000' });

    p = (
      await client.staff.savePayroll({
        params,
        body: {
          lines: [{ employeeId: binh.id, bonus: '300000', deduction: '100000', note: 'đi trễ 2 lần' }],
        },
      })
    ).body as PayrollDto;
    expect(line('Bình')).toMatchObject({ gross: '7200000', toPay: '6200000', note: 'đi trễ 2 lần' });

    // A wage line typed by hand in overheads is pointed out (it may count twice).
    await prisma.overheadExpense.create({
      data: {
        branchId: (await prisma.branch.findFirstOrThrow()).id,
        year: y,
        month: m,
        category: 'Lương',
        amount: 500000,
      },
    });
    p = (await client.staff.closePayroll({ params, body: {} })).body as PayrollDto;
    expect(p).toMatchObject({
      status: 'CLOSED',
      gross: '7687500',
      overheadAmount: '7687500',
      otherSalaryOverhead: '500000',
    });

    // Closed: attendance and advances of the month are frozen.
    const edit = await client.staff.saveAttendance({
      body: {
        employeeId: an.id,
        date: first,
        shiftId: null,
        checkIn: '08:00',
        checkOut: '18:00',
        note: null,
      },
    });
    expect(edit.status).toBe(409);
    const late = await client.staff.createAdvance({
      body: { employeeId: an.id, date: today, amount: '1000', method: 'CASH', note: null },
    });
    expect(late.status).toBe(409);

    // Re-saving Chi phí chung recreates its lines: the payroll still finds its own.
    const months = (await client.overheads.year({ query: { year: y } })).body as {
      lines: { category: string; amount: string; note: string | null }[];
    }[];
    await client.overheads.saveMonth({ params, body: { lines: months[m - 1]!.lines } });
    expect(((await client.staff.payroll({ params })).body as PayrollDto).overheadAmount).toBe('7687500');

    const paid = (
      await client.staff.payLine({
        params: { id: line('An').lineId! },
        body: { method: 'CASH', date: today },
      })
    ).body as PayrollDto;
    expect(paid.lines.find((l) => l.name === 'An')).toMatchObject({ paidMethod: 'CASH' });
    const out = (await client.cash.list({ query: { from: today, to: today } })).body as { totalOut: string };
    expect(out.totalOut).toBe('487500');

    expect((await client.staff.reopenPayroll({ params, body: { reason: 'tính lại lương' } })).status).toBe(
      400,
    );
    await client.staff.unpayLine({ params: { id: line('An').lineId! }, body: { reason: 'trả nhầm người' } });
    expect(
      ((await client.cash.list({ query: { from: today, to: today } })).body as { totalOut: string }).totalOut,
    ).toBe('200000');
    p = (await client.staff.reopenPayroll({ params, body: { reason: 'tính lại lương' } })).body as PayrollDto;
    expect(p).toMatchObject({ status: 'DRAFT', overheadAmount: null });
    expect(await prisma.overheadExpense.count({ where: { note: { startsWith: 'Theo bảng lương' } } })).toBe(
      0,
    );

    // Reopened: an advance can be cancelled again.
    const cancelled = await client.staff.cancelAdvance({
      params: { id: transfer.id },
      body: { reason: 'ghi nhầm người' },
    });
    expect(cancelled.body).toMatchObject({ cancelled: true });
    p = (await client.staff.payroll({ params })).body as PayrollDto;
    expect(line('Bình')).toMatchObject({ advance: '0', toPay: '7200000' });
  });
});
