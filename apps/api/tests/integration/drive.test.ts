import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/core/db';
import { clientFor, makeUser, resetDb, serverUrl, startServer, stopServer } from '../helpers/harness';

beforeAll(startServer);
afterAll(stopServer);
beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

type Client = ReturnType<typeof clientFor>;

const jpeg = (seed: string) =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`JFIF ${seed} `.repeat(20))]).toString(
    'base64',
  );

async function fileDocument(client: Client, date: string, partner: string, photo: string) {
  const doc = await client.documents.create({
    body: { kind: 'PURCHASE', date, number: '0001', partner, amount: '100000', note: null, receiptId: null },
  });
  const id = (doc.body as { id: number }).id;
  await client.documents.addFile({
    params: { id },
    body: { name: 'hoa-don.jpg', dataBase64: jpeg(photo), thumbBase64: null },
  });
  return id;
}

const readAll = async (body: unknown) => {
  const chunks: Buffer[] = [];
  for await (const c of body as AsyncIterable<Buffer>) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
};

/** Fake Google: device flow, token refresh, folder create, resumable upload. Other URLs pass through. */
function mockGoogle(opts: { pendingPolls?: number } = {}) {
  const realFetch = globalThis.fetch;
  let polls = 0;
  const uploads: { name: string; parents: string[]; bytes: Buffer }[] = [];
  let lastMeta: { name: string; parents: string[] } | null = null;
  const idToken = `x.${Buffer.from(JSON.stringify({ email: 'chu.quan@gmail.com' })).toString('base64url')}.y`;
  const json = (v: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json', ...headers } });

  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!/googleapis\.com/.test(url)) return realFetch(input, init);
    const form = init?.body instanceof URLSearchParams ? init.body : null;
    if (url.endsWith('/device/code'))
      return json({
        device_code: 'dev-1',
        user_code: 'ABCD-EFGH',
        verification_url: 'https://www.google.com/device',
        expires_in: 1800,
        interval: 5,
      });
    if (url.endsWith('/token') && form?.get('grant_type')?.includes('device_code'))
      return polls++ < (opts.pendingPolls ?? 0)
        ? json({ error: 'authorization_pending' }, 428)
        : json({ access_token: 'at', refresh_token: 'rt-secret', id_token: idToken });
    if (url.endsWith('/token') && form?.get('grant_type') === 'refresh_token')
      return form.get('refresh_token') === 'rt-secret'
        ? json({ access_token: 'at-2' })
        : json({ error: 'invalid_grant' }, 400);
    if (url.endsWith('/revoke')) return json({});
    if (url.includes('/drive/v3/files?fields=id')) return json({ id: 'folder-1' });
    if (url.includes('uploadType=resumable')) {
      lastMeta = JSON.parse(String(init?.body)) as { name: string; parents: string[] };
      return new Response(null, {
        status: 200,
        headers: { location: 'https://www.googleapis.com/upload/session-1' },
      });
    }
    if (url.endsWith('/upload/session-1')) {
      uploads.push({ ...lastMeta!, bytes: await readAll(init?.body) });
      return json({ id: 'file-1', webViewLink: 'https://drive.google.com/file/d/file-1/view' });
    }
    return json({ error: 'unexpected ' + url }, 500);
  });
  return { uploads };
}

describe('documents .zip export', () => {
  it('downloads a period as a zip through a short-lived link (ADMIN only)', async () => {
    const admin = await makeUser({ username: 'chu', role: 'ADMIN' });
    const staff = await makeUser({ username: 'thungan', role: 'STAFF' });
    await fileDocument(admin.client, '2026-10-03', 'Chợ Bình Điền', 'a');
    await fileDocument(admin.client, '2026-09-03', 'Tháng trước', 'b');

    expect((await staff.client.documents.exportLink({ body: { period: '2026-10' } })).status).toBe(403);
    const link = await admin.client.documents.exportLink({ body: { period: '2026-10' } });
    expect(link.body).toMatchObject({ fileName: 'chung-tu-2026-10.zip' });
    const { url } = link.body as { url: string };

    const res = await fetch(serverUrl() + url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    const zip = Buffer.from(await res.arrayBuffer());
    expect(zip.subarray(0, 2).toString()).toBe('PK');
    const names = zip.toString('utf8');
    expect(names).toContain('chung-tu-2026-10/Danh sach chung tu.xlsx');
    expect(names).toContain('chung-tu-2026-10/2026-10-03 Mua vào - Chợ Bình Điền (HĐ 0001)/hoa-don.jpg');
    expect(names).not.toContain('Tháng trước');

    // The link is bound to its period and is not a login token.
    expect((await fetch(serverUrl() + url.replace('period=2026-10', 'period=2026-09'))).status).toBe(401);
    const t = new URL(url, 'http://x').searchParams.get('t')!;
    expect((await clientFor(t).documents.partners()).status).toBe(401);
  });
});

describe('Google Drive upload', () => {
  it('connects with a device code, then uploads the month as a new zip', async () => {
    const { client, user } = await makeUser({ username: 'chu', role: 'ADMIN' });
    const google = mockGoogle({ pendingPolls: 1 });
    await fileDocument(client, '2026-10-03', 'Chợ Bình Điền', 'c');

    expect((await client.drive.status()).body).toEqual({ configured: true, connected: false, email: null });
    const code = await client.drive.connect({ body: {} });
    expect(code.body).toMatchObject({
      userCode: 'ABCD-EFGH',
      verificationUrl: 'https://www.google.com/device',
    });
    expect((await client.drive.poll({ body: {} })).body).toMatchObject({ state: 'PENDING' });
    expect((await client.drive.poll({ body: {} })).body).toMatchObject({
      state: 'CONNECTED',
      status: { connected: true, email: 'chu.quan@gmail.com' },
    });

    // The refresh token is stored encrypted, never in clear.
    const stored = await prisma.setting.findUniqueOrThrow({ where: { key: 'google_drive' } });
    expect(JSON.stringify(stored.value)).not.toContain('rt-secret');
    // …and never shows up in the public settings.
    expect(JSON.stringify((await client.settings.get()).body)).not.toContain('google');

    const up = await client.drive.uploadDocuments({ body: { period: '2026-10' } });
    expect(up.status).toBe(200);
    expect(up.body).toMatchObject({
      documents: 1,
      files: 1,
      link: 'https://drive.google.com/file/d/file-1/view',
    });
    expect(google.uploads).toHaveLength(1);
    expect(google.uploads[0]!.name).toMatch(/^chung-tu-2026-10 \(.+\)\.zip$/);
    expect(google.uploads[0]!.parents).toEqual(['folder-1']);
    expect(google.uploads[0]!.bytes.subarray(0, 2).toString()).toBe('PK');

    const audit = await prisma.auditLog.findMany({
      where: { entity: 'google_drive', userId: user.id },
      orderBy: { id: 'asc' },
    });
    expect(audit.map((a) => a.action)).toEqual(['CONNECT', 'UPLOAD_DOCUMENTS']);
  });

  it('refuses an empty period and asks to reconnect when Google revoked access', async () => {
    const { client } = await makeUser({ username: 'chu', role: 'ADMIN' });
    mockGoogle();
    await client.drive.connect({ body: {} });
    await client.drive.poll({ body: {} });

    const empty = await client.drive.uploadDocuments({ body: { period: '2025-01' } });
    expect(empty.body).toMatchObject({ error: { code: 'NOTHING_TO_UPLOAD' } });

    // Simulate the user removing the app from their Google account.
    const s = await prisma.setting.findUniqueOrThrow({ where: { key: 'google_drive' } });
    await prisma.setting.update({
      where: { key: 'google_drive' },
      data: { value: { ...(s.value as object), refreshToken: 'broken' } },
    });
    await fileDocument(client, '2026-10-03', 'Chợ', 'd');
    const res = await client.drive.uploadDocuments({ body: { period: '2026-10' } });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: { code: 'DRIVE_NOT_CONNECTED' } });
    expect((await client.drive.status()).body).toMatchObject({ connected: false });
  });
});
