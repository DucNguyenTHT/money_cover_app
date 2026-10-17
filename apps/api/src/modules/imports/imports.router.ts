import { Router, type Request } from 'express';
import { initServer } from '@ts-rest/express';
import { importsContract, IMPORT_KINDS, type ImportKind } from '../../contracts/imports.contract';
import { authMiddleware, currentUser } from '../../core/auth';
import { notFound } from '../../core/errors';
import * as imports from './imports.service';

const s = initServer();

export const importsRouter = s.router(importsContract, {
  preview: async ({ params, body }) => ({
    status: 200,
    body: await imports.preview(params.kind, body.fileBase64),
  }),
  commit: async ({ req, params, body }) => ({
    status: 200,
    body: await imports.commit(currentUser(req).id, params.kind, body.fileBase64, body.date),
  }),
});

/** Binary template download lives outside ts-rest (it returns a file, not JSON). */
export const importTemplates = Router();
importTemplates.get(
  '/api/imports/templates/:kind',
  (req, res, next) => {
    (req as Request & { tsRestRoute?: object }).tsRestRoute = { metadata: { roles: ['ADMIN'] } };
    authMiddleware(req, res, next);
  },
  async (req, res, next) => {
    try {
      const kind = req.params.kind as ImportKind;
      if (!IMPORT_KINDS.includes(kind)) throw notFound('Mẫu');
      const buf = await imports.template(kind);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="mau-${kind}.xlsx"`);
      res.send(buf);
    } catch (e) {
      next(e);
    }
  },
);
