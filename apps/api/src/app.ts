import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import { createExpressEndpoints, initServer } from '@ts-rest/express';
import { generateOpenApi } from '@ts-rest/open-api';
import { env } from './config/env';
import { api } from './contracts';
import { authMiddleware } from './core/auth';
import { errorHandler } from './core/errors';
import { logger } from './core/logger';
import { authRouter } from './modules/auth/auth.router';
import { usersRouter } from './modules/users/users.router';
import { settingsRouter } from './modules/settings/settings.router';
import { catalogRouter } from './modules/catalog/catalog.router';
import { venueRouter } from './modules/venue/venue.router';
import { inventoryRouter } from './modules/inventory/inventory.router';
import { menuRouter, overheadsRouter, pricingRouter } from './modules/menu/menu.router';
import { importsRouter, importTemplates } from './modules/imports/imports.router';
import { dayClosingRouter, kitchenRouter, ordersRouter } from './modules/orders/orders.router';
import { stocktakeRouter } from './modules/stocktake/stocktake.router';
import { reportExport, reportsRouter } from './modules/reports/reports.router';
import { documentExport, documentFiles, documentsRouter } from './modules/documents/documents.router';
import { driveRouter } from './modules/drive/drive.router';
import { backupsRouter } from './modules/backup/backup.router';
import { telegramRouter } from './modules/telegram/telegram.router';
import { cashRouter } from './modules/cash/cash.router';
import { suppliersRouter } from './modules/suppliers/suppliers.router';
import { staffRouter } from './modules/staff/staff.router';
import { bankRouter } from './modules/bank/bank.router';
import { einvoiceRouter } from './modules/einvoice/einvoice.router';
import { productionRouter } from './modules/production/production.router';
import { customersRouter } from './modules/customers/customers.router';
import { promotionsRouter } from './modules/promotions/promotions.router';
import { architecturePage } from './modules/architecture/architecture.page';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: env.CORS_ORIGIN.split(',') }));
  app.use(express.json({ limit: '15mb' }));
  if (env.NODE_ENV !== 'test')
    app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use(
    '/api/auth/login',
    rateLimit({
      windowMs: 60_000,
      limit: 10,
      skip: () => env.NODE_ENV === 'test',
      standardHeaders: true,
      legacyHeaders: false,
      handler: (_req, res) => {
        res
          .status(429)
          .json({ error: { code: 'TOO_MANY_ATTEMPTS', message: 'Thử đăng nhập quá nhiều lần, đợi 1 phút' } });
      },
    }),
  );

  // Before Swagger's static handler, which owns /api/docs/*.
  app.use(architecturePage);
  const openApi = generateOpenApi(api, { info: { title: 'Kế toán quán ăn API', version: '0.1.0' } });
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApi));

  app.use(importTemplates);
  app.use(reportExport);
  app.use(documentFiles);
  app.use(documentExport);

  const s = initServer();
  const router = s.router(api, {
    auth: authRouter,
    users: usersRouter,
    settings: settingsRouter,
    catalog: catalogRouter,
    venue: venueRouter,
    inventory: inventoryRouter,
    menu: menuRouter,
    pricing: pricingRouter,
    overheads: overheadsRouter,
    imports: importsRouter,
    orders: ordersRouter,
    kitchen: kitchenRouter,
    dayClosing: dayClosingRouter,
    stocktake: stocktakeRouter,
    reports: reportsRouter,
    documents: documentsRouter,
    drive: driveRouter,
    backups: backupsRouter,
    telegram: telegramRouter,
    cash: cashRouter,
    suppliers: suppliersRouter,
    staff: staffRouter,
    bank: bankRouter,
    einvoice: einvoiceRouter,
    production: productionRouter,
    customers: customersRouter,
    promotions: promotionsRouter,
  });
  createExpressEndpoints(api, router, app, {
    globalMiddleware: [authMiddleware],
    requestValidationErrorHandler: (err, _req, res) => {
      const first = err.body?.issues[0] ?? err.query?.issues[0] ?? err.pathParams?.issues[0];
      res.status(400).json({
        error: {
          code: 'VALIDATION',
          message: first?.message ?? 'Dữ liệu gửi lên không hợp lệ',
          details: { body: err.body?.issues, query: err.query?.issues, params: err.pathParams?.issues },
        },
      });
    },
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy API' } });
  });
  app.use(errorHandler);
  return app;
}
