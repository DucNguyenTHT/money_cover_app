import { initServer } from '@ts-rest/express';
import { staffContract } from '../../contracts/staff.contract';
import { currentUser } from '../../core/auth';
import * as staff from './staff.service';
import * as payroll from './payroll.service';

const s = initServer();

export const staffRouter = s.router(staffContract, {
  employees: async () => ({ status: 200, body: await staff.employees() }),
  createEmployee: async ({ req, body }) => ({
    status: 201,
    body: await staff.saveEmployee(currentUser(req).id, null, body),
  }),
  updateEmployee: async ({ req, params, body }) => ({
    status: 200,
    body: await staff.saveEmployee(currentUser(req).id, params.id, body),
  }),
  shifts: async () => ({ status: 200, body: await staff.shifts() }),
  createShift: async ({ req, body }) => ({
    status: 201,
    body: await staff.saveShift(currentUser(req).id, null, body),
  }),
  updateShift: async ({ req, params, body }) => ({
    status: 200,
    body: await staff.saveShift(currentUser(req).id, params.id, body),
  }),
  attendance: async ({ query }) => ({ status: 200, body: await staff.attendance(query.from, query.to) }),
  saveAttendance: async ({ req, body }) => ({
    status: 200,
    body: await staff.saveAttendance(currentUser(req).id, body),
  }),
  fillAttendance: async ({ req, body }) => ({
    status: 200,
    body: await staff.fillAttendance(currentUser(req).id, body.from, body.to),
  }),
  myAttendance: async ({ req }) => ({ status: 200, body: await staff.me(currentUser(req)) }),
  clock: async ({ req, body }) => ({ status: 200, body: await staff.clock(currentUser(req), body.action) }),
  payroll: async ({ params }) => ({ status: 200, body: await payroll.get(params.year, params.month) }),
  savePayroll: async ({ req, params, body }) => ({
    status: 200,
    body: await payroll.save(currentUser(req).id, params.year, params.month, body.lines),
  }),
  closePayroll: async ({ req, params }) => ({
    status: 200,
    body: await payroll.close(currentUser(req).id, params.year, params.month),
  }),
  reopenPayroll: async ({ req, params, body }) => ({
    status: 200,
    body: await payroll.reopen(currentUser(req).id, params.year, params.month, body.reason),
  }),
  payLine: async ({ req, params, body }) => ({
    status: 200,
    body: await payroll.payLine(currentUser(req), params.id, body.method, body.date),
  }),
  unpayLine: async ({ req, params, body }) => ({
    status: 200,
    body: await payroll.unpayLine(currentUser(req), params.id, body.reason),
  }),
  createAdvance: async ({ req, body }) => ({
    status: 201,
    body: await payroll.createAdvance(currentUser(req), body),
  }),
  cancelAdvance: async ({ req, params, body }) => ({
    status: 200,
    body: await payroll.cancelAdvance(currentUser(req), params.id, body.reason),
  }),
});
