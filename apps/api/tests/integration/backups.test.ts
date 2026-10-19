import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/core/db';
import { seal } from '../../src/core/secret-box';
import { makeUser, resetDb, startServer, stopServer } from '../helpers/harness';

const DIR = path.resolve('storage/test-backups');

beforeAll(startServer);
afterAll(stopServer);
beforeEach(async () => {
  await resetDb();
  rmSync(DIR, { recursive: true, force: true });
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.FAKE_PG_DUMP_FAIL;
});

const dumps = () => readdirSync(DIR).filter((n) => n.endsWith('.dump'));

/** Linked Drive account + fake Google that records uploads and deletions in the backup folder. */
async function linkDrive(existing: number) {
  await prisma.setting.create({
    data: {
      key: 'google_drive',
      value: {
        refreshToken: seal('rt-secret', 'google-refresh-token'),
        email: 'chu@gmail.com',
        folderId: null,
      },
    },
  });
  const realFetch = globalThis.fetch;
  const uploaded: string[] = [];
  const deleted: string[] = [];
  const json = (v: unknown, status = 200) =>
    new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (!/googleapis\.com/.test(url)) return realFetch(input, init);
    if (url.endsWith('/token')) return json({ access_token: 'at' });
    if (url.includes('/drive/v3/files?fields=id')) return json({ id: 'backup-folder' });
    if (url.includes('uploadType=resumable')) {
      uploaded.push((JSON.parse(String(init?.body)) as { name: string }).name);
      return new Response(null, { headers: { location: 'https://www.googleapis.com/upload/session-b' } });
    }
    if (url.endsWith('/upload/session-b')) {
      for await (const _ of init?.body as unknown as AsyncIterable<unknown>);
      return json({ id: 'new', webViewLink: 'https://drive.google.com/file/d/new/view' });
    }
    if (url.includes('/drive/v3/files?q=')) {
      expect(decodeURIComponent(url)).toContain("'backup-folder' in parents");
      // newest first: the one just uploaded, then `existing` older backups
      const files = Array.from({ length: existing + 1 }, (_, i) => ({
        id: `f${i}`,
        name: `ketoan-old-${i}.dump`,
        createdTime: '2026-10-01T00:00:00Z',
      }));
      return json({ files });
    }
    if (init?.method === 'DELETE') {
      deleted.push(url.split('/').pop()!);
      return new Response(null, { status: 204 });
    }
    return json({ error: 'unexpected ' + url }, 500);
  });
  return { uploaded, deleted };
}

describe('database backup', () => {
  it('dumps on demand, keeps the outcome and clears the dashboard warning', async () => {
    const { client } = await makeUser({ username: 'chu', role: 'ADMIN' });
    expect((await client.backups.status()).body).toMatchObject({ issue: 'NEVER', last: null, files: [] });
    expect((await client.reports.dashboard()).body).toMatchObject({ alerts: { backup: 'NEVER' } });

    const res = await client.backups.run({ body: {} });
    expect(res.status).toBe(200);
    const s = res.body as {
      issue: string | null;
      last: { ok: boolean; file: string; trigger: string; drive: null };
    };
    expect(s).toMatchObject({ issue: null, last: { ok: true, trigger: 'MANUAL', drive: null } });
    expect(s.last.file).toMatch(/^ketoan-\d{8}-\d{4}\.dump$/);
    const content = readFileSync(path.join(DIR, s.last.file), 'utf8');
    expect(content.startsWith('PGDMP')).toBe(true);
    // pg_dump gets a plain libpq URL (no Prisma "schema" parameter).
    expect(content).toContain('--dbname=postgresql://');
    expect(content).not.toContain('schema=');
    expect((await client.reports.dashboard()).body).toMatchObject({ alerts: { backup: null } });
  });

  it('a failed dump leaves no file and raises the warning', async () => {
    const { client } = await makeUser({ username: 'chu', role: 'ADMIN' });
    process.env.FAKE_PG_DUMP_FAIL = '1';
    const s = (await client.backups.run({ body: {} })).body as {
      issue: string;
      last: { ok: boolean; error: string };
    };
    expect(s).toMatchObject({ issue: 'FAILED', last: { ok: false } });
    expect(s.last.error).toContain('connection to server failed');
    expect(existsSync(DIR) ? dumps() : []).toEqual([]);
    expect((await client.reports.dashboard()).body).toMatchObject({ alerts: { backup: 'FAILED' } });
  });

  it('keeps the newest 30 dumps on the server', async () => {
    const { client } = await makeUser({ username: 'chu', role: 'ADMIN' });
    mkdirSync(DIR, { recursive: true });
    for (let d = 1; d <= 30; d++)
      writeFileSync(path.join(DIR, `ketoan-202601${String(d).padStart(2, '0')}-0200.dump`), 'old');
    await client.backups.run({ body: {} });
    const left = dumps();
    expect(left).toHaveLength(30);
    expect(left).not.toContain('ketoan-20260101-0200.dump');
  });

  it('copies each backup to Google Drive and keeps the newest 30 there', async () => {
    const { client } = await makeUser({ username: 'chu', role: 'ADMIN' });
    const google = await linkDrive(31);
    const s = (await client.backups.run({ body: {} })).body as {
      last: { file: string; drive: { ok: boolean; link: string } };
      drive: { connected: boolean; enabled: boolean };
    };
    expect(s.drive).toMatchObject({ connected: true, enabled: true });
    expect(s.last.drive).toMatchObject({ ok: true, link: 'https://drive.google.com/file/d/new/view' });
    expect(google.uploaded).toEqual([s.last.file]);
    expect(google.deleted).toEqual(['f30', 'f31']);
  });

  it('turned off in settings: no upload; Drive errors never undo the local backup', async () => {
    const { client } = await makeUser({ username: 'chu', role: 'ADMIN' });
    const google = await linkDrive(0);
    await client.settings.update({ body: { settings: { backup_drive: false } } });
    await client.backups.run({ body: {} });
    expect(google.uploaded).toEqual([]);

    await client.settings.update({ body: { settings: { backup_drive: true } } });
    vi.restoreAllMocks();
    const realFetch = globalThis.fetch;
    // Google unreachable (the test's own API calls still go through).
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) =>
      /googleapis\.com/.test(String(input))
        ? Promise.reject(new TypeError('offline'))
        : realFetch(input, init),
    );
    const s = (await client.backups.run({ body: {} })).body as {
      issue: string;
      last: { ok: boolean; drive: { ok: boolean; error: string } };
    };
    expect(s.last.ok).toBe(true);
    expect(s.last.drive.ok).toBe(false);
    expect(s.issue).toBe('DRIVE_FAILED');
  });

  it('is for ADMIN only', async () => {
    const { client } = await makeUser({ username: 'thungan', role: 'STAFF' });
    expect((await client.backups.status()).status).toBe(403);
    expect((await client.backups.run({ body: {} })).status).toBe(403);
  });
});
