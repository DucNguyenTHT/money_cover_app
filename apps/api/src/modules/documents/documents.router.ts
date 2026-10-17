import { Router, type Request } from 'express';
import jwt from 'jsonwebtoken';
import { initServer } from '@ts-rest/express';
import { documentPeriod, documentsContract } from '../../contracts/documents.contract';
import { env } from '../../config/env';
import { writeAudit } from '../../core/audit';
import { authMiddleware, currentUser } from '../../core/auth';
import { prisma } from '../../core/db';
import { badRequest, unauthorized } from '../../core/errors';
import { storedPath } from '../../core/storage';
import * as documents from './documents.service';
import { writeDocumentsZip, zipFileName } from './archive';

const s = initServer();

export const documentsRouter = s.router(documentsContract, {
  list: async ({ query }) => ({ status: 200, body: await documents.list(query) }),
  partners: async () => ({ status: 200, body: await documents.partners() }),
  get: async ({ params }) => ({ status: 200, body: await documents.get(params.id) }),
  create: async ({ req, body }) => ({ status: 201, body: await documents.create(currentUser(req).id, body) }),
  update: async ({ req, params, body }) => {
    const { reason, ...input } = body;
    return { status: 200, body: await documents.update(currentUser(req), params.id, input, reason) };
  },
  remove: async ({ req, params, body }) => ({
    status: 200,
    body: await documents.remove(currentUser(req), params.id, body?.reason),
  }),
  addFile: async ({ req, params, body }) => ({
    status: 201,
    body: await documents.addFile(currentUser(req).id, params.id, body),
  }),
  removeFile: async ({ req, params, body }) => ({
    status: 200,
    body: await documents.removeFile(currentUser(req), params.id, params.fileId, body?.reason),
  }),
  exportLink: async ({ req, body }) => {
    const t = jwt.sign({ sub: String(currentUser(req).id), period: body.period }, EXPORT_SECRET(), {
      expiresIn: '2m',
    });
    return {
      status: 200,
      body: {
        url: `/api/document-export?period=${body.period}&t=${encodeURIComponent(t)}`,
        fileName: zipFileName(body.period),
      },
    };
  },
});

// ---------------------------------------------------------------- .zip export
// A plain link (short-lived signed token in the URL) so the browser streams a large file straight to disk.
// The token is signed with a derived key: it can never be used as a login token.

const EXPORT_SECRET = () => `${env.JWT_SECRET}:document-export`;

export const documentExport = Router();
documentExport.get('/api/document-export', async (req, res, next) => {
  try {
    const period = documentPeriod.safeParse(req.query.period);
    if (!period.success) throw badRequest('Kỳ không hợp lệ');
    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(String(req.query.t ?? ''), EXPORT_SECRET()) as jwt.JwtPayload;
    } catch {
      throw unauthorized('Link tải đã hết hạn, hãy bấm tải lại');
    }
    if (payload.period !== period.data) throw unauthorized('Link tải không hợp lệ');
    const user = await prisma.user.findUnique({ where: { id: Number(payload.sub) } });
    if (!user?.active || user.role !== 'ADMIN') throw unauthorized('Tài khoản không có quyền tải');

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(zipFileName(period.data))}`,
    );
    res.setHeader('Cache-Control', 'no-store');
    const r = await writeDocumentsZip(period.data, res);
    await writeAudit(prisma, {
      entity: 'document',
      entityId: period.data,
      action: 'EXPORT_ZIP',
      after: r,
      userId: user.id,
    });
  } catch (e) {
    if (res.headersSent) res.destroy(e as Error);
    else next(e);
  }
});

// ---------------------------------------------------------------- file download
// Raw bytes, outside ts-rest. The web app fetches with the bearer token and shows a blob URL.

export const documentFiles = Router();
documentFiles.get(
  '/api/document-files/:fileId',
  (req, res, next) => {
    (req as Request & { tsRestRoute?: object }).tsRestRoute = { metadata: { roles: ['ADMIN', 'STAFF'] } };
    authMiddleware(req, res, next);
  },
  async (req, res, next) => {
    try {
      const fileId = Number(req.params.fileId);
      if (!Number.isInteger(fileId)) throw badRequest('Mã file không hợp lệ');
      const f = await documents.fileForDownload(fileId, req.query.thumb === '1');
      const download = req.query.download === '1';
      res.setHeader('Content-Type', f.mime);
      res.setHeader(
        'Content-Disposition',
        `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      );
      // A stored file never changes; the sandbox stops an XML/PDF from running anything if opened directly.
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      res.setHeader(
        'Content-Security-Policy',
        "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      );
      res.sendFile(storedPath(f.path), (err) => {
        if (!err || res.headersSent) return;
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          res.removeHeader('Content-Disposition');
          res.removeHeader('Cache-Control');
          res.status(404).json({
            error: {
              code: 'FILE_MISSING',
              message: 'Không tìm thấy file trên máy chủ — hãy khôi phục từ bản sao lưu',
            },
          });
        } else next(err);
      });
    } catch (e) {
      next(e);
    }
  },
);
