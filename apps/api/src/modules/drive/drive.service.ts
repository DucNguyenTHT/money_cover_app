// "Gửi lên Google Drive": the ADMIN links one Google account (device flow), then uploads a period's
// documents .zip by hand. The connection is stored in `settings` under GOOGLE_KEY (not part of the
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

interface Stored {
  refreshToken: string; // sealed
  email: string | null;
  folderId: string | null;
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

export async function status(): Promise<DriveStatus> {
  const s = await load();
  return { configured: google.isConfigured(), connected: !!s, email: s?.email ?? null };
}

/** One sign-in at a time (single shop server): the pending device code lives in memory. */
let pending: { deviceCode: string; expiresAt: number; userId: number } | null = null;

export async function connect(userId: number): Promise<DeviceCode> {
  const d = await google.startDeviceFlow();
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
  const r = await google.pollDeviceFlow(pending.deviceCode);
  if (r.state === 'PENDING') return { state: r.state, status: await status() };
  pending = null;
  if (r.state !== 'CONNECTED') return { state: r.state, status: await status() };

  const old = await load();
  await save({ refreshToken: seal(r.refreshToken, SEAL), email: r.email, folderId: old?.folderId ?? null });
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
    return { token: await google.accessToken(refresh), stored };
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
