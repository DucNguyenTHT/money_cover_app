import { Router, type Request } from 'express';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { initServer } from '@ts-rest/express';
import { reportsContract } from '../../contracts/reports.contract';
import { authMiddleware, currentUser } from '../../core/auth';
import { badRequest } from '../../core/errors';
import * as reports from './reports.service';

const s = initServer();

export const reportsRouter = s.router(reportsContract, {
  dashboard: async () => ({ status: 200, body: await reports.dashboard() }),
  pnlMonth: async ({ params }) => ({ status: 200, body: await reports.pnlMonth(params.month) }),
  pnlRange: async ({ query }) => ({ status: 200, body: await reports.pnlRange(query.from, query.to) }),
  tax: async ({ query }) => ({ status: 200, body: await reports.taxReport(query.year) }),
  daily: async ({ query }) => ({ status: 200, body: await reports.daily(query.from, query.to) }),
  sales: async ({ query }) => ({ status: 200, body: await reports.sales(query.from, query.to) }),
  dishProfit: async ({ query }) => ({
    status: 200,
    body: await reports.dishProfit(query.from, query.to, query.channel),
  }),
  cancellations: async ({ query }) => ({
    status: 200,
    body: await reports.cancellations(query.from, query.to),
  }),
  stockMovement: async ({ query }) => ({
    status: 200,
    body: await reports.stockMovement(query.from, query.to),
  }),
  variance: async ({ query }) => ({ status: 200, body: await reports.variance(query.from, query.to) }),
  periods: async ({ query }) => ({ status: 200, body: await reports.periods(query.year) }),
  lock: async ({ req, params }) => ({
    status: 200,
    body: await reports.lock(currentUser(req), params.month),
  }),
  unlock: async ({ req, params, body }) => ({
    status: 200,
    body: await reports.unlock(currentUser(req), params.month, body.reason),
  }),
  auditLogs: async ({ query }) => ({ status: 200, body: await reports.auditLogs(query) }),
});

// ---------------------------------------------------------------- Excel export
// The page already holds the report table; the server only turns it into a real .xlsx with number formats.

const exportBody = z.object({
  filename: z.string().regex(/^[\w.-]{1,80}$/),
  title: z.string().max(200),
  sheets: z
    .array(
      z.object({
        name: z.string().min(1).max(31),
        columns: z
          .array(z.object({ header: z.string(), kind: z.enum(['text', 'money', 'qty', 'pct', 'int']) }))
          .min(1)
          .max(40),
        rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))).max(20000),
        /** Row indexes rendered bold (totals). */
        bold: z.array(z.number().int()).optional(),
      }),
    )
    .min(1)
    .max(10),
});

const FORMATS = { money: '#,##0;[Red]-#,##0', qty: '#,##0.###', pct: '0.0"%"', int: '0', text: '@' } as const;

export const reportExport = Router();
reportExport.post(
  '/api/reports/export.xlsx',
  (req, res, next) => {
    (req as Request & { tsRestRoute?: object }).tsRestRoute = { metadata: { roles: ['ADMIN'] } };
    authMiddleware(req, res, next);
  },
  async (req, res, next) => {
    try {
      const parsed = exportBody.safeParse(req.body);
      if (!parsed.success) throw badRequest('Dữ liệu xuất Excel không hợp lệ');
      const { filename, title, sheets } = parsed.data;
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Kế toán quán ăn';
      for (const sh of sheets) {
        const ws = wb.addWorksheet(sh.name.replace(/[\\/?*[\]:]/g, ' '));
        ws.addRow([title]).font = { bold: true, size: 13 };
        ws.addRow([]);
        const head = ws.addRow(sh.columns.map((c) => c.header));
        head.font = { bold: true };
        head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF4FE' } };
        sh.rows.forEach((r, i) => {
          const row = ws.addRow(
            r.map((v, k) => {
              const kind = sh.columns[k]?.kind ?? 'text';
              if (v === null || v === '') return null;
              return kind === 'text' ? String(v) : Number(v);
            }),
          );
          if (sh.bold?.includes(i)) row.font = { bold: true };
        });
        sh.columns.forEach((c, k) => {
          const col = ws.getColumn(k + 1);
          col.numFmt = FORMATS[c.kind];
          col.width = c.kind === 'text' ? Math.min(40, Math.max(12, c.header.length + 4)) : 16;
        });
        ws.views = [{ state: 'frozen', ySplit: 3 }];
      }
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
      res.send(Buffer.from(await wb.xlsx.writeBuffer()));
    } catch (e) {
      next(e);
    }
  },
);
