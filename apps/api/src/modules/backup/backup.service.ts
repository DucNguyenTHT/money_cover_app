// Database backup: pg_dump (custom format) into BACKUP_DIR every night at `backup_hour`, keeping the newest
// KEEP dumps, and a copy of each one in the linked Google Drive. The outcome of the last run is kept in
// `settings` under STATUS_KEY (not part of the public settings schema).
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, open, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Prisma } from '@prisma/client';
import { env } from '../../config/env';
import { prisma } from '../../core/db';
import { writeAudit } from '../../core/audit';
import { conflict } from '../../core/errors';
import { logger } from '../../core/logger';
import type { BackupRun, BackupStatus } from '../../contracts/backups.contract';
import { backupDue, backupIssue, nextSlot, shopClock } from '../../domain/backup/schedule';
import * as drive from '../drive/drive.service';
import * as telegram from '../telegram/telegram.service';
import { getSettings } from '../settings/settings.service';

const STATUS_KEY = 'backup_status';
export const KEEP = 30;

interface DocumentsRun {
  at: string;
  sent: number;
  pending: number;
  error: string | null;
}

interface Stored {
  last: BackupRun | null;
  lastOk: BackupRun | null;
  documents?: DocumentsRun | null;
}

async function load(): Promise<Stored> {
  const row = await prisma.setting.findUnique({ where: { key: STATUS_KEY } });
  return (row?.value as Stored | undefined) ?? { last: null, lastOk: null };
}

async function save(v: Stored) {
  const value = v as unknown as Prisma.InputJsonValue;
  await prisma.setting.upsert({
    where: { key: STATUS_KEY },
    update: { value },
    create: { key: STATUS_KEY, value },
  });
}

const dir = () => path.resolve(env.BACKUP_DIR);

/** ketoan-YYYYMMDD-HHmm.dump in shop time (same names as scripts/backup-db.ps1, so both sort together). */
function fileName(at: Date) {
  const local = new Date(at.getTime() + 7 * 3600_000).toISOString();
  return `ketoan-${local.slice(0, 10).replace(/-/g, '')}-${local.slice(11, 16).replace(':', '')}.dump`;
}

/** pg_dump wants a plain libpq URL: Prisma's own "schema" parameter would be rejected. */
function dumpUrl() {
  const url = new URL(env.BACKUP_DATABASE_URL || env.DATABASE_URL);
  url.searchParams.delete('schema');
  return url.toString();
}

/** Run pg_dump into `file`; resolves once the dump is complete and looks like a real custom-format dump. */
async function dump(file: string) {
  const [cmd, ...pre] = env.BACKUP_PG_DUMP.trim().split(/\s+/);
  const args = [...pre, '--format=custom', '--no-owner', '--no-privileges', `--dbname=${dumpUrl()}`];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd!, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = createWriteStream(file);
    let stderr = '';
    child.stderr.on(
      'data',
      (d: Buffer) => (stderr += d.toString()).length > 4000 && (stderr = stderr.slice(-4000)),
    );
    child.stdout.pipe(out);
    child.on('error', (e) =>
      reject(new Error(`Không chạy được pg_dump (${(e as NodeJS.ErrnoException).code ?? e.message})`)),
    );
    child.on('close', (code) => {
      out.end(() =>
        code === 0
          ? resolve()
          : reject(new Error(`pg_dump lỗi (mã ${code}): ${stderr.trim().slice(0, 300)}`)),
      );
    });
  });
  const fh = await open(file, 'r');
  try {
    const head = Buffer.alloc(5);
    await fh.read(head, 0, 5, 0);
    const { size } = await fh.stat();
    if (head.toString('latin1') !== 'PGDMP' || size < 1024)
      throw new Error(`File sao lưu không hợp lệ (${size} bytes)`);
    return size;
  } finally {
    await fh.close();
  }
}

async function listFiles() {
  const names = (await readdir(dir()).catch(() => [] as string[]))
    .filter((n) => /^ketoan-.*\.dump$/.test(n))
    .sort()
    .reverse();
  return Promise.all(
    names.map(async (name) => {
      const s = await stat(path.join(dir(), name));
      return { name, bytes: s.size, at: s.mtime.toISOString() };
    }),
  );
}

/** Keep the newest KEEP dumps on the server. */
async function prune() {
  for (const f of (await listFiles()).slice(KEEP)) await rm(path.join(dir(), f.name), { force: true });
}

let running = false;

export async function run(trigger: 'AUTO' | 'MANUAL', userId: number | null): Promise<BackupStatus> {
  if (running) throw conflict('BACKUP_BUSY', 'Đang sao lưu, đợi xong rồi thử lại');
  running = true;
  const at = new Date();
  const result: BackupRun = {
    at: at.toISOString(),
    trigger,
    ok: false,
    file: null,
    bytes: null,
    error: null,
    drive: null,
    telegram: null,
  };
  try {
    await mkdir(dir(), { recursive: true });
    let name = fileName(at);
    if ((await listFiles()).some((f) => f.name === name))
      name = name.replace('.dump', `-${at.getUTCSeconds()}.dump`);
    const file = path.join(dir(), name);
    try {
      result.bytes = await dump(file);
      result.file = name;
      result.ok = true;
      await prune();
    } catch (e) {
      await rm(file, { force: true });
      result.error = (e as Error).message;
    }
    // The copy on Drive is a bonus: its failure never undoes the local backup.
    if (result.ok && (await getSettings()).backup_drive && (await drive.isConnected())) {
      try {
        const up = await drive.uploadBackup(file, name, KEEP);
        result.drive = { ok: true, error: null, link: up.link };
      } catch (e) {
        result.drive = { ok: false, error: (e as Error).message, link: null };
      }
    }
    if (result.ok && (await getSettings()).backup_telegram && (await telegram.isReady())) {
      try {
        const caption = `Sao lưu dữ liệu ${name} · ${Math.max(1, Math.round((result.bytes ?? 0) / 1024))} KB`;
        await telegram.sendBackup(file, caption);
        result.telegram = { ok: true, error: null };
      } catch (e) {
        result.telegram = { ok: false, error: (e as Error).message };
      }
    }
    const prev = await load();
    await save({ ...prev, last: result, lastOk: result.ok ? result : prev.lastOk });
    if (userId !== null)
      await writeAudit(prisma, { entity: 'backup', entityId: name, action: 'RUN', after: result, userId });
    if (!result.ok) logger.error({ error: result.error }, 'Sao lưu dữ liệu thất bại');
  } finally {
    running = false;
  }
  startDocuments();
  return status();
}

// ---- invoice files to Telegram, after each backup, in the background (can take minutes: Telegram allows
// about 20 messages a minute in a group).
const DOCS_PER_RUN = 100;
const DOCS_PAUSE_MS = env.NODE_ENV === 'test' ? 0 : 3200;
let documentsJob: Promise<void> | null = null;

function startDocuments() {
  if (documentsJob) return;
  documentsJob = (async () => {
    try {
      if (!(await getSettings()).backup_telegram_documents) return;
      const r = await telegram.sendDocuments(DOCS_PER_RUN, DOCS_PAUSE_MS);
      if (!r) return;
      const s = await load();
      await save({ ...s, documents: { at: new Date().toISOString(), ...r } });
      if (r.error) logger.error({ error: r.error }, 'Gửi chứng từ qua Telegram thất bại');
    } catch (e) {
      logger.error(e, 'Gửi chứng từ qua Telegram lỗi');
    } finally {
      documentsJob = null;
    }
  })();
}

/** Tests: wait for the background sending started by the last backup. */
export const documentsIdle = async () => {
  await documentsJob;
};

export async function status(): Promise<BackupStatus> {
  const [s, settings, files, d, t] = await Promise.all([
    load(),
    getSettings(),
    listFiles(),
    drive.status(),
    telegram.status(),
  ]);
  const now = new Date();
  return {
    last: s.last,
    lastOk: s.lastOk,
    issue: backupIssue({
      now,
      last: s.last,
      lastOkAt: s.lastOk?.at ?? null,
      documentsFailed: !!s.documents?.error,
    }),
    files: files.slice(0, 10),
    keep: KEEP,
    nextAt: nextSlot(now, settings.backup_hour).toISOString(),
    running,
    drive: { enabled: settings.backup_drive, connected: d.connected, email: d.email },
    telegram: { enabled: settings.backup_telegram, ready: t.ready, chatTitle: t.chatTitle },
    documents: {
      enabled: settings.backup_telegram_documents,
      running: !!documentsJob,
      last: s.documents ?? null,
    },
  };
}

/** For the dashboard / bell. */
export async function issue() {
  const s = await load();
  return backupIssue({
    now: new Date(),
    last: s.last,
    lastOkAt: s.lastOk?.at ?? null,
    documentsFailed: !!s.documents?.error,
  });
}

/** Check every 10 minutes (and soon after start-up) whether tonight's backup is due. */
export function startScheduler() {
  const tick = async () => {
    try {
      if (running) return;
      const [s, settings] = await Promise.all([load(), getSettings()]);
      const now = new Date();
      if (
        backupDue({
          now,
          hour: settings.backup_hour,
          lastOkAt: s.lastOk?.at ?? null,
          lastAttemptAt: s.last?.at ?? null,
        })
      ) {
        logger.info(`Sao lưu dữ liệu tự động (${shopClock(now).date})`);
        await run('AUTO', null);
      }
    } catch (e) {
      logger.error(e, 'Lịch sao lưu lỗi');
    }
  };
  setTimeout(tick, 60_000).unref();
  setInterval(tick, 10 * 60_000).unref();
}
