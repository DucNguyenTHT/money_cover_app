import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { commonErrors, type RouteMeta } from './common';

const c = initContract();
const admin = { roles: ['ADMIN'] } satisfies RouteMeta;

export const backupRunSchema = z.object({
  at: z.string(),
  trigger: z.enum(['AUTO', 'MANUAL']),
  ok: z.boolean(),
  file: z.string().nullable(),
  bytes: z.number().nullable(),
  error: z.string().nullable(),
  /** Upload to Google Drive (null = not attempted: Drive not linked or turned off). */
  drive: z.object({ ok: z.boolean(), error: z.string().nullable(), link: z.string().nullable() }).nullable(),
  /** Sent to Telegram (null = not attempted: no bot / chat, or turned off). */
  telegram: z.object({ ok: z.boolean(), error: z.string().nullable() }).nullable().optional(),
});
export type BackupRun = z.infer<typeof backupRunSchema>;

export const backupStatusSchema = z.object({
  last: backupRunSchema.nullable(),
  lastOk: backupRunSchema.nullable(),
  /** What the owner should be warned about (null = all good). */
  issue: z.enum(['NEVER', 'FAILED', 'STALE', 'DRIVE_FAILED', 'TELEGRAM_FAILED']).nullable(),
  /** Newest dumps on the server, newest first. */
  files: z.array(z.object({ name: z.string(), bytes: z.number(), at: z.string() })),
  keep: z.number(),
  nextAt: z.string(),
  running: z.boolean(),
  drive: z.object({ enabled: z.boolean(), connected: z.boolean(), email: z.string().nullable() }),
  telegram: z.object({ enabled: z.boolean(), ready: z.boolean(), chatTitle: z.string().nullable() }),
  /** Invoice files sent to Telegram after each backup (in the background, a limited number per run). */
  documents: z.object({
    enabled: z.boolean(),
    running: z.boolean(),
    last: z
      .object({ at: z.string(), sent: z.number(), pending: z.number(), error: z.string().nullable() })
      .nullable(),
  }),
});
export type BackupStatus = z.infer<typeof backupStatusSchema>;

export const backupsContract = c.router(
  {
    status: {
      method: 'GET',
      path: '/api/backups',
      responses: { 200: backupStatusSchema, ...commonErrors },
      metadata: admin,
      summary: 'Tình trạng sao lưu dữ liệu',
    },
    run: {
      method: 'POST',
      path: '/api/backups/run',
      body: z.object({}),
      responses: { 200: backupStatusSchema, ...commonErrors },
      metadata: admin,
      summary: 'Sao lưu ngay (và gửi lên Google Drive nếu đã kết nối)',
    },
  },
  { strictStatusCodes: true },
);
