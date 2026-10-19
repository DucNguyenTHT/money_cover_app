// Minimal Google OAuth (device flow) + Drive v3 client over fetch. No SDK: four endpoints are all we need.
// Device flow fits a LAN server: Google does not allow browser sign-in on "pos.local", but any phone can
// open google.com/device and type the code shown in the app.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { env } from '../../config/env';
import { AppError, badRequest } from '../../core/errors';

const OAUTH = 'https://oauth2.googleapis.com';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
/** drive.file = only files this app created; it can never read the rest of the user's Drive. */
export const SCOPES = 'openid email https://www.googleapis.com/auth/drive.file';

/** OAuth client of type "TVs and Limited Input devices" (entered in Settings, or GOOGLE_CLIENT_* env). */
export interface Credentials {
  clientId: string;
  clientSecret: string;
}

/** Fallback when nothing was entered in Settings. */
export const envCredentials = (): Credentials | null =>
  env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
    : null;

const client = (c: Credentials | null) => {
  if (!c) throw badRequest('Chưa nhập Google Client ID / Client secret (Hệ thống → Cài đặt → Google Drive)');
  return { client_id: c.clientId, client_secret: c.clientSecret };
};

/** Network / Google failures become a readable 409 instead of a 500. */
export const googleError = (message: string, details?: unknown) =>
  new AppError(409, 'GOOGLE_ERROR', message, details);

async function post(url: string, form: Record<string, string>) {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form),
    });
  } catch {
    throw googleError('Không kết nối được Google — kiểm tra Internet của máy chủ');
  }
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

export async function startDeviceFlow(creds: Credentials | null) {
  const { status, body } = await post(`${OAUTH}/device/code`, {
    client_id: client(creds).client_id,
    scope: SCOPES,
  });
  if (status !== 200)
    throw googleError(`Google từ chối yêu cầu kết nối (${String(body.error ?? status)})`, body);
  return {
    deviceCode: String(body.device_code),
    userCode: String(body.user_code),
    verificationUrl: String(body.verification_url ?? 'https://www.google.com/device'),
    expiresIn: Number(body.expires_in ?? 1800),
    interval: Number(body.interval ?? 5),
  };
}

export type PollResult =
  | { state: 'PENDING' }
  | { state: 'EXPIRED' | 'DENIED' }
  | { state: 'CONNECTED'; refreshToken: string; email: string | null };

const emailFromIdToken = (idToken: unknown): string | null => {
  if (typeof idToken !== 'string') return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1]!, 'base64url').toString('utf8')) as {
      email?: string;
    };
    return payload.email ?? null;
  } catch {
    return null;
  }
};

export async function pollDeviceFlow(creds: Credentials | null, deviceCode: string): Promise<PollResult> {
  const { status, body } = await post(`${OAUTH}/token`, {
    ...client(creds),
    device_code: deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });
  if (status === 200 && typeof body.refresh_token === 'string')
    return { state: 'CONNECTED', refreshToken: body.refresh_token, email: emailFromIdToken(body.id_token) };
  const err = String(body.error ?? '');
  if (err === 'authorization_pending' || err === 'slow_down') return { state: 'PENDING' };
  if (err === 'access_denied') return { state: 'DENIED' };
  if (err === 'expired_token') return { state: 'EXPIRED' };
  throw googleError(`Google báo lỗi khi kết nối (${err || status})`, body);
}

/** Thrown when the refresh token no longer works (user removed access in their Google account). */
export class RevokedError extends Error {}

export async function accessToken(creds: Credentials | null, refreshToken: string): Promise<string> {
  const { status, body } = await post(`${OAUTH}/token`, {
    ...client(creds),
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  if (status === 200 && typeof body.access_token === 'string') return body.access_token;
  if (body.error === 'invalid_grant') throw new RevokedError();
  throw googleError(`Không lấy được quyền truy cập Google (${String(body.error ?? status)})`, body);
}

export async function revoke(refreshToken: string) {
  await post(`${OAUTH}/revoke`, { token: refreshToken }).catch(() => undefined);
}

async function driveFetch(token: string, url: string, init: RequestInit = {}) {
  try {
    return await fetch(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${token}` },
    });
  } catch {
    throw googleError('Mất kết nối tới Google Drive — kiểm tra Internet của máy chủ');
  }
}

/** The app's folder, re-created if the user deleted / trashed it. */
export async function ensureFolder(token: string, folderId: string | null, name: string): Promise<string> {
  if (folderId) {
    const res = await driveFetch(token, `${DRIVE}/files/${folderId}?fields=id,trashed`);
    if (res.ok && !((await res.json()) as { trashed?: boolean }).trashed) return folderId;
  }
  const res = await driveFetch(token, `${DRIVE}/files?fields=id`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' }),
  });
  if (!res.ok) throw googleError(`Không tạo được thư mục trên Drive (${res.status})`, await res.text());
  return ((await res.json()) as { id: string }).id;
}

/** Resumable upload: the file is streamed from disk, never held in memory. */
export async function uploadFile(token: string, folderId: string, name: string, path: string, mime: string) {
  const size = (await stat(path)).size;
  const init = await driveFetch(token, `${UPLOAD}/files?uploadType=resumable&fields=id,webViewLink`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=UTF-8',
      'x-upload-content-type': mime,
      'x-upload-content-length': String(size),
    },
    body: JSON.stringify({ name, parents: [folderId] }),
  });
  const session = init.headers.get('location');
  if (!init.ok || !session)
    throw googleError(`Drive từ chối tải lên (${init.status})`, await init.text().catch(() => ''));
  const res = await driveFetch(token, session, {
    method: 'PUT',
    headers: { 'content-type': mime, 'content-length': String(size) },
    body: createReadStream(path) as unknown as RequestInit['body'],
    duplex: 'half',
  } as RequestInit);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 403 && text.includes('storageQuotaExceeded'))
      throw googleError('Google Drive đã đầy dung lượng');
    throw googleError(`Tải lên Drive thất bại (${res.status})`, text);
  }
  const body = (await res.json()) as { id: string; webViewLink?: string };
  return { id: body.id, link: body.webViewLink ?? null, size };
}

/** Files the app put in a folder, newest first (drive.file scope only ever sees the app's own files). */
export async function listFolder(token: string, folderId: string) {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const res = await driveFetch(
    token,
    `${DRIVE}/files?q=${q}&orderBy=createdTime desc&pageSize=200&fields=files(id,name,createdTime)`,
  );
  if (!res.ok) throw googleError(`Không đọc được thư mục trên Drive (${res.status})`, await res.text());
  return ((await res.json()) as { files?: { id: string; name: string; createdTime: string }[] }).files ?? [];
}

export async function deleteFile(token: string, fileId: string) {
  const res = await driveFetch(token, `${DRIVE}/files/${fileId}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw googleError(`Không xoá được bản cũ trên Drive (${res.status})`);
}
