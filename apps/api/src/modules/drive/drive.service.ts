// "Gửi lên Google Drive": the ADMIN links one Google account (device flow), then uploads a period's
// documents .zip by hand. The OAuth client is entered in Settings (env as fallback). The connection is stored in `settings` under GOOGLE_KEY (not part of the
// public settings schema, so it never leaves the server); the refresh token is encrypted.
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../core/db';
import { writeAudit } from '../../core/audit';
import { conflict } from '../../core/errors';
import { open, seal } from '../../core/secret-box';
import type { DeviceCode, DriveStatus } from '../../contracts/drive.contract';
import { writeDocumentsZip, zipFileName } from '../documents/archive';
import * as google from './google';

const GOOGLE_KEY = 'google_drive';
const SEAL = 'google-refresh-token';
const FOLDER_NAME = 'Kế toán quán - Chứng từ';
const BACKUP_FOLDER_NAME = 'Kế toán quán - Sao lưu dữ liệu';

interface Stored {
  refreshToken: string; // sealed
  email: string | null;
  folderId: string | null;
  /** Folder of the nightly database backups (created on first upload). */
  backupFolderId?: string | null;
}

async function load(): Promise<Stored | null> {
  const row = await prisma.setting.findUnique({ where: { key: GOOGLE_KEY } });
  return (row?.value as Stored | undefined) ?? null;
}

async function save(v: Stored | null) {
  if (!v) await prisma.setting.deleteMany({ where: { key: GOOGLE_KEY } });
  else {
    const value = v as unknown as Prisma.InputJsonValue;
    await prisma.setting.upsert({
      where: { key: GOOGLE_KEY },
      update: { value },
      create: { key: GOOGLE_KEY, value },
    });
  }
}

// ---- Google OAuth client (Client ID / secret), entered by the ADMIN in Settings; env is the fallback.
const CLIENT_KEY = 'google_client';
const CLIENT_SEAL = 'google-client-secret';

interface StoredClient {
  clientId: string;
  clientSecret: string; // sealed
}

async function loadClient(): Promise<StoredClient | null> {
  const row = await prisma.setting.findUnique({ where: { key: CLIENT_KEY } });
  return (row?.value as StoredClient | undefined) ?? null;
}

/** Credentials in use and where they come from. */
async function credentials(): Promise<{ creds: google.Credentials; source: 'ADMIN' | 'ENV' } | null> {
  const c = await loadClient();
  const secret = c ? open(c.clientSecret, CLIENT_SEAL) : null;
  if (c && secret) return { creds: { clientId: c.clientId, clientSecret: secret }, source: 'ADMIN' };
  const fromEnv = google.envCredentials();
  return fromEnv ? { creds: fromEnv, source: 'ENV' } : null;
}

export async function status(): Promise<DriveStatus> {
  const [s, c] = await Promise.all([load(), credentials()]);
  return {
    configured: !!c,
    clientId: c?.creds.clientId ?? null,
    clientSource: c?.source ?? null,
    connected: !!s,
    email: s?.email ?? null,
  };
}

/** A connection belongs to the client it was made with: changing the client drops it (sign in again). */
async function dropConnection(userId: number, reason: string) {
  const s = await load();
  if (!s) return;
  await save(null);
  await writeAudit(prisma, {
    entity: 'google_drive',
    entityId: 'connection',
    action: 'DISCONNECT',
    reason,
    before: { email: s.email },
    userId,
  });
}

export async function saveClient(userId: number, input: { clientId: string; clientSecret: string }) {
  const before = await credentials();
  const value = {
    clientId: input.clientId,
    clientSecret: seal(input.clientSecret, CLIENT_SEAL),
  } as unknown as Prisma.InputJsonValue;
  await prisma.setting.upsert({
    where: { key: CLIENT_KEY },
    update: { value },
    create: { key: CLIENT_KEY, value },
  });
  if (before?.creds.clientId !== input.clientId) await dropConnection(userId, 'Đổi Google Client ID');
  // The secret itself is never written to the audit log.
  await writeAudit(prisma, {
    entity: 'google_drive',
    entityId: 'client',
    action: 'SET_CLIENT',
    before: before ? { clientId: before.creds.clientId, source: before.source } : null,
    after: { clientId: input.clientId },
    userId,
  });
  return status();
}

export async function clearClient(userId: number) {
  const c = await loadClient();
  if (c) {
    await prisma.setting.deleteMany({ where: { key: CLIENT_KEY } });
    if (google.envCredentials()?.clientId !== c.clientId)
      await dropConnection(userId, 'Xoá Google Client ID');
    await writeAudit(prisma, {
      entity: 'google_drive',
      entityId: 'client',
      action: 'CLEAR_CLIENT',
      before: { clientId: c.clientId },
      userId,
    });
  }
  return status();
}

/** One sign-in at a time (single shop server): the pending device code lives in memory. */
let pending: { deviceCode: string; expiresAt: number; userId: number } | null = null;

export async function connect(userId: number): Promise<DeviceCode> {
  const d = await google.startDeviceFlow((await credentials())?.creds ?? null);
  const expiresAt = Date.now() + d.expiresIn * 1000;
  pending = { deviceCode: d.deviceCode, expiresAt, userId };
  return {
    userCode: d.userCode,
    verificationUrl: d.verificationUrl,
    expiresAt: new Date(expiresAt).toISOString(),
    interval: d.interval,
  };
}

export async function poll(userId: number) {
  if (!pending || pending.expiresAt < Date.now()) {
    pending = null;
    return { state: 'EXPIRED' as const, status: await status() };
  }
  const r = await google.pollDeviceFlow((await credentials())?.creds ?? null, pending.deviceCode);
  if (r.state === 'PENDING') return { state: r.state, status: await status() };
  pending = null;
  if (r.state !== 'CONNECTED') return { state: r.state, status: await status() };

  const old = await load();
  await save({
    refreshToken: seal(r.refreshToken, SEAL),
    email: r.email,
    folderId: old?.folderId ?? null,
    backupFolderId: old?.backupFolderId ?? null,
  });
  await writeAudit(prisma, {
    entity: 'google_drive',
    entityId: 'connection',
    action: 'CONNECT',
    after: { email: r.email },
    userId,
  });
  return { state: r.state, status: await status() };
}

export async function disconnect(userId: number): Promise<DriveStatus> {
  const s = await load();
  if (s) {
    const token = open(s.refreshToken, SEAL);
    if (token) await google.revoke(token);
    await save(null);
    await writeAudit(prisma, {
      entity: 'google_drive',
      entityId: 'connection',
      action: 'DISCONNECT',
      before: { email: s.email },
      userId,
    });
  }
  return status();
}

/** A fresh access token, or a clear "connect again" error when Google no longer accepts ours. */
async function session(): Promise<{ token: string; stored: Stored }> {
  const stored = await load();
  if (!stored) throw conflict('DRIVE_NOT_CONNECTED', 'Chưa kết nối Google Drive');
  const refresh = open(stored.refreshToken, SEAL);
  try {
    if (!refresh) throw new google.RevokedError();
    return { token: await google.accessToken((await credentials())?.creds ?? null, refresh), stored };
  } catch (e) {
    if (!(e instanceof google.RevokedError)) throw e;
    await save(null);
    throw conflict('DRIVE_NOT_CONNECTED', 'Quyền truy cập Google Drive đã hết hiệu lực — hãy kết nối lại');
  }
}

const stamp = (d = new Date()) =>
  new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(d)
    .replace(/[/:]/g, '-')
    .replace(/,?\s+/g, ' ');

let uploading = false;

export async function uploadDocuments(userId: number, period: string) {
  if (uploading) throw conflict('DRIVE_BUSY', 'Đang có một lần gửi lên Drive, đợi xong rồi thử lại');
  uploading = true;
  const dir = await mkdtemp(path.join(tmpdir(), 'ketoan-zip-'));
  try {
    const { token, stored } = await session();
    const file = path.join(dir, zipFileName(period));
    const zip = await writeDocumentsZip(period, createWriteStream(file));
    if (zip.documents === 0) throw conflict('NOTHING_TO_UPLOAD', 'Kỳ này chưa có chứng từ nào để gửi');

    const folderId = await google.ensureFolder(token, stored.folderId, FOLDER_NAME);
    if (folderId !== stored.folderId) await save({ ...stored, folderId });
    // Every upload is a new file (date-stamped name): an older copy on Drive is never overwritten.
    const fileName = zipFileName(period).replace(/\.zip$/, ` (${stamp()}).zip`);
    const up = await google.uploadFile(token, folderId, fileName, file, 'application/zip');
    const result = { fileName, bytes: up.size, documents: zip.documents, files: zip.files, link: up.link };
    await writeAudit(prisma, {
      entity: 'google_drive',
      entityId: period,
      action: 'UPLOAD_DOCUMENTS',
      after: result,
      userId,
    });
    return result;
  } finally {
    uploading = false;
    await rm(dir, { recursive: true, force: true });
  }
}

/** True when a Google account is linked (the backup job only uploads then). */
export const isConnected = async () => !!(await load());

/**
 * Upload one database backup into its own Drive folder, then delete the oldest backups there so only the
 * newest `keep` stay (the app can only see and delete files it created itself).
 */
export async function uploadBackup(file: string, name: string, keep: number) {
  const { token, stored } = await session();
  const folderId = await google.ensureFolder(token, stored.backupFolderId ?? null, BACKUP_FOLDER_NAME);
  if (folderId !== stored.backupFolderId) await save({ ...stored, backupFolderId: folderId });
  const up = await google.uploadFile(token, folderId, name, file, 'application/octet-stream');
  const files = await google.listFolder(token, folderId);
  for (const old of files.filter((x) => x.name.endsWith('.dump')).slice(keep))
    await google.deleteFile(token, old.id);
  return { link: up.link, bytes: up.size };
}
