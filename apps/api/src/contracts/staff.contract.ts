import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { PAY_TYPES, PAYROLL_STATUSES } from '../domain/enums';
import { commonErrors, decimalString, isoDate, reason, type RouteMeta } from './common';

const c = initContract();
const admin = { roles: ['ADMIN'] } satisfies RouteMeta;
/** Any signed-in user (own check-in / check-out). */
const signedIn = {} satisfies RouteMeta;
const id = z.object({ id: z.coerce.number().int() });
const ym = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});
const clock = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'Giờ dạng HH:mm (ví dụ 07:30)');
const nonNegative = decimalString.refine((v) => Number(v) >= 0, 'Không được âm');
const positive = decimalString.refine((v) => Number(v) > 0, 'Số tiền phải lớn hơn 0');

// ---------------------------------------------------------------- employees & shifts

export const employeeInput = z.object({
  name: z.string().trim().min(1, 'Nhập tên nhân viên').max(80),
  phone: z.string().trim().max(30).nullable(),
  position: z.string().trim().max(60).nullable(),
  payType: z.enum(PAY_TYPES),
  /** Per hour (HOURLY) or per month (MONTHLY). */
  rate: nonNegative,
  /** Login of this person, for self check-in at the till. */
  userId: z.number().int().nullable(),
  active: z.boolean(),
});
export const employeeSchema = employeeInput.extend({ id: z.number(), userName: z.string().nullable() });
export type EmployeeDto = z.infer<typeof employeeSchema>;

export const shiftInput = z.object({
  name: z.string().trim().min(1, 'Nhập tên ca').max(40),
  start: clock,
  end: clock,
  sort: z.number().int(),
  active: z.boolean(),
});
export const shiftSchema = shiftInput.extend({ id: z.number(), hours: z.number() });
export type ShiftDto = z.infer<typeof shiftSchema>;

// ---------------------------------------------------------------- attendance

export const attendanceInput = z.object({
  employeeId: z.number().int(),
  date: isoDate,
  /** Scheduled shift. */
  shiftId: z.number().int().nullable(),
  /** Actual times "HH:mm"; a time before the business-day start is the next morning. */
  checkIn: clock.nullable(),
  checkOut: clock.nullable(),
  note: z.string().trim().max(200).nullable(),
});
export const attendanceSchema = attendanceInput.extend({ hours: decimalString });
export type AttendanceDto = z.infer<typeof attendanceSchema>;

export const myAttendanceSchema = z.object({
  /** null: this login is not linked to an employee. */
  employee: z.object({ id: z.number(), name: z.string() }).nullable(),
  today: isoDate,
  row: attendanceSchema.nullable(),
  shift: shiftSchema.nullable(),
});
export type MyAttendance = z.infer<typeof myAttendanceSchema>;

// ---------------------------------------------------------------- payroll

export const salaryAdvanceInput = z.object({
  employeeId: z.number().int(),
  date: isoDate,
  amount: positive,
  method: z.enum(['CASH', 'TRANSFER']),
  note: z.string().trim().max(200).nullable(),
});
export const salaryAdvanceSchema = salaryAdvanceInput.extend({
  id: z.number(),
  employeeName: z.string(),
  createdByName: z.string(),
  cancelled: z.boolean(),
  cancelReason: z.string().nullable(),
});
export type SalaryAdvanceDto = z.infer<typeof salaryAdvanceSchema>;

export const payrollLineSchema = z.object({
  /** Saved line (needed to pay it once the payroll is closed). */
  lineId: z.number().nullable(),
  employeeId: z.number(),
  name: z.string(),
  position: z.string().nullable(),
  payType: z.enum(PAY_TYPES),
  rate: decimalString,
  /** Days with worked hours, and the hours (from attendance). */
  days: z.number(),
  hours: decimalString,
  basePay: decimalString,
  bonus: decimalString,
  deduction: decimalString,
  advance: decimalString,
  /** base + bonus − deduction: what the month costs (goes to overheads). */
  gross: decimalString,
  /** gross − advances: still to hand over. */
  toPay: decimalString,
  note: z.string().nullable(),
  paidAt: z.string().nullable(),
  paidMethod: z.string().nullable(),
});
export type PayrollLineDto = z.infer<typeof payrollLineSchema>;

export const payrollSchema = z.object({
  year: z.number(),
  month: z.number(),
  status: z.enum(PAYROLL_STATUSES),
  closedAt: z.string().nullable(),
  closedByName: z.string().nullable(),
  /** Month locked in accounting: read only. */
  locked: z.boolean(),
  lines: z.array(payrollLineSchema),
  advances: z.array(salaryAdvanceSchema),
  gross: decimalString,
  toPay: decimalString,
  /** Overhead line written when closing (category "Lương"); null while not closed. */
  overheadAmount: decimalString.nullable(),
  /** Other "Lương" overhead lines typed by hand that month (wages might count twice). */
  otherSalaryOverhead: decimalString,
});
export type PayrollDto = z.infer<typeof payrollSchema>;

export const staffContract = c.router(
  {
    employees: {
      method: 'GET',
      path: '/api/employees',
      responses: { 200: z.array(employeeSchema), ...commonErrors },
      metadata: admin,
    },
    createEmployee: {
      method: 'POST',
      path: '/api/employees',
      body: employeeInput,
      responses: { 201: employeeSchema, ...commonErrors },
      metadata: admin,
    },
    updateEmployee: {
      method: 'PUT',
      path: '/api/employees/:id',
      pathParams: id,
      body: employeeInput,
      responses: { 200: employeeSchema, ...commonErrors },
      metadata: admin,
    },
    shifts: {
      method: 'GET',
      path: '/api/shifts',
      responses: { 200: z.array(shiftSchema), ...commonErrors },
      metadata: admin,
    },
    createShift: {
      method: 'POST',
      path: '/api/shifts',
      body: shiftInput,
      responses: { 201: shiftSchema, ...commonErrors },
      metadata: admin,
    },
    updateShift: {
      method: 'PUT',
      path: '/api/shifts/:id',
      pathParams: id,
      body: shiftInput,
      responses: { 200: shiftSchema, ...commonErrors },
      metadata: admin,
    },
    attendance: {
      method: 'GET',
      path: '/api/attendance',
      query: z.object({ from: isoDate, to: isoDate }),
      responses: {
        200: z.object({
          employees: z.array(z.object({ id: z.number(), name: z.string(), position: z.string().nullable() })),
          shifts: z.array(shiftSchema),
          rows: z.array(attendanceSchema),
          /** Months whose payroll is closed (attendance read only). */
          closedMonths: z.array(z.string()),
        }),
        ...commonErrors,
      },
      metadata: admin,
      summary: 'Lịch ca và chấm công trong khoảng ngày',
    },
    saveAttendance: {
      method: 'PUT',
      path: '/api/attendance',
      body: attendanceInput,
      responses: { 200: z.object({ row: attendanceSchema.nullable() }), ...commonErrors },
      metadata: admin,
      summary: 'Xếp ca / sửa giờ vào ra (để trống hết = xoá)',
    },
    fillAttendance: {
      method: 'POST',
      path: '/api/attendance/fill',
      body: z.object({ from: isoDate, to: isoDate }),
      responses: { 200: z.object({ filled: z.number() }), ...commonErrors },
      metadata: admin,
      summary: 'Điền giờ vào / ra theo ca cho các ngày đã xếp ca mà chưa chấm',
    },
    myAttendance: {
      method: 'GET',
      path: '/api/attendance/me',
      responses: { 200: myAttendanceSchema, ...commonErrors },
      metadata: signedIn,
    },
    clock: {
      method: 'POST',
      path: '/api/attendance/me/clock',
      body: z.object({ action: z.enum(['IN', 'OUT']) }),
      responses: { 200: myAttendanceSchema, ...commonErrors },
      metadata: signedIn,
      summary: 'Nhân viên tự bấm vào ca / ra ca',
    },
    payroll: {
      method: 'GET',
      path: '/api/payrolls/:year/:month',
      pathParams: ym,
      responses: { 200: payrollSchema, ...commonErrors },
      metadata: admin,
    },
    savePayroll: {
      method: 'PUT',
      path: '/api/payrolls/:year/:month',
      pathParams: ym,
      body: z.object({
        lines: z.array(
          z.object({
            employeeId: z.number().int(),
            bonus: nonNegative,
            deduction: nonNegative,
            note: z.string().trim().max(200).nullable(),
          }),
        ),
      }),
      responses: { 200: payrollSchema, ...commonErrors },
      metadata: admin,
    },
    closePayroll: {
      method: 'POST',
      path: '/api/payrolls/:year/:month/close',
      pathParams: ym,
      body: z.object({}),
      responses: { 200: payrollSchema, ...commonErrors },
      metadata: admin,
      summary: 'Chốt bảng lương: giữ số liệu, ghi tổng lương vào chi phí chung tháng đó',
    },
    reopenPayroll: {
      method: 'POST',
      path: '/api/payrolls/:year/:month/reopen',
      pathParams: ym,
      body: z.object({ reason }),
      responses: { 200: payrollSchema, ...commonErrors },
      metadata: admin,
    },
    payLine: {
      method: 'POST',
      path: '/api/payroll-lines/:id/pay',
      pathParams: id,
      body: z.object({ method: z.enum(['CASH', 'TRANSFER']), date: isoDate }),
      responses: { 200: payrollSchema, ...commonErrors },
      metadata: admin,
      summary: 'Đánh dấu đã trả lương (tiền mặt: tự ghi chi sổ quỹ)',
    },
    unpayLine: {
      method: 'POST',
      path: '/api/payroll-lines/:id/unpay',
      pathParams: id,
      body: z.object({ reason }),
      responses: { 200: payrollSchema, ...commonErrors },
      metadata: admin,
    },
    createAdvance: {
      method: 'POST',
      path: '/api/salary-advances',
      body: salaryAdvanceInput,
      responses: { 201: salaryAdvanceSchema, ...commonErrors },
      metadata: admin,
      summary: 'Tạm ứng lương (tiền mặt: tự ghi chi sổ quỹ)',
    },
    cancelAdvance: {
      method: 'POST',
      path: '/api/salary-advances/:id/cancel',
      pathParams: id,
      body: z.object({ reason }),
      responses: { 200: salaryAdvanceSchema, ...commonErrors },
      metadata: admin,
    },
  },
  { strictStatusCodes: true },
);
