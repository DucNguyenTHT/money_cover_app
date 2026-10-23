import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/core/db';
import { documentsIdle } from '../../src/modules/backup/backup.service';
import { storedPath } from '../../src/core/storage';
import { clientFor, makeUser, resetDb, startServer, stopServer } from '../helpers/harness';

const TOKEN = '123456789:AAHfake-token-for-tests-0123456789abcd';

beforeAll(startServer);
afterAll(stopServer);
beforeEach(async () => {
  await resetDb();
  rmSync(path.resolve('storage/test-backups'), { recursive: true, force: true });
});
afterEach(() => vi.restoreAllMocks());

/** Fake Telegram Bot API: records what the bot sent and keeps the files (getFile / download). */
function mockTelegram(
  opts: { tokenOk?: boolean; sendFails?: boolean; failFile?: string; corruptFile?: string } = {},
) {
  const realFetch = globalThis.fetch;
  const files = new Map<string, Buffer>();
  const sent: {
    method: string;
    chatId: string;
    text?: string;
    fileName?: string;
    bytes?: number;
    caption?: string;
  }[] = [];
  const json = (v: unknown, status = 200) =>
    new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (!url.startsWith('https://api.telegram.org/')) return realFetch(input, init);
    if (!url.includes(`/bot${TOKEN}/`) || opts.tokenOk === false)
      return json({ ok: false, description: 'Unauthorized' }, 401);
    if (url.includes('/file/bot')) {
      const id = decodeURIComponent(url.split('/').pop()!);
      const bytes = files.get(id);
      if (!bytes) return new Response('not found', { status: 404 });
      return new Response(id === `F-${opts.corruptFile}` ? Buffer.from('hỏng') : bytes);
    }
    const method = url.split('/').pop()!;
    if (method === 'getFile') {
      const { file_id } = JSON.parse(String(init?.body)) as { file_id: string };
      if (!files.has(file_id)) return json({ ok: false, description: 'Bad Request: invalid file_id' }, 400);
      return json({
        ok: true,
        result: { file_id, file_path: `documents/${file_id}`, file_size: files.get(file_id)!.length },
      });
    }
    if (method === 'getMe')
      return json({ ok: true, result: { id: 1, username: 'quan_backup_bot', first_name: 'Sao lưu' } });
    if (method === 'getUpdates')
      return json({
        ok: true,
        result: [
          {
            update_id: 1,
            message: { chat: { id: 555, type: 'private', first_name: 'Chủ', last_name: 'Quán' } },
          },
          {
            update_id: 2,
            my_chat_member: { chat: { id: -1001234, type: 'supergroup', title: 'Sao lưu quán' } },
          },
        ],
      });
    if (method === 'sendMessage') {
      const b = JSON.parse(String(init?.body)) as { chat_id: string; text: string };
      sent.push({ method, chatId: b.chat_id, text: b.text });
      return json({ ok: true, result: { message_id: 1 } });
    }
    if (method === 'sendDocument') {
      if (opts.sendFails) return json({ ok: false, description: 'Bad Request: chat not found' }, 400);
      const form = init?.body as FormData;
      const doc = form.get('document') as File;
      if (doc.name === opts.failFile)
        return json({ ok: false, description: 'Bad Request: file rejected' }, 400);
      sent.push({
        method,
        chatId: String(form.get('chat_id')),
        fileName: doc.name,
        bytes: doc.size,
        caption: String(form.get('caption')),
      });
      files.set(`F-${doc.name}`, Buffer.from(await doc.arrayBuffer()));
      return json({ ok: true, result: { message_id: 2, document: { file_id: `F-${doc.name}` } } });
    }
    return json({ ok: false, description: 'unexpected ' + method }, 400);
  });
  return { sent };
}

describe('Telegram backup destination', () => {
  it('bot token → pick a chat → each backup is sent there; the token never leaves the server', async () => {
    const { client } = await makeUser({ username: 'chu', role: 'ADMIN' });
    const tg = mockTelegram();

    expect((await client.telegram.saveToken({ body: { botToken: 'not-a-token' } })).status).toBe(400);
    const saved = await client.telegram.saveToken({ body: { botToken: TOKEN } });
    expect(saved.body).toEqual({
      botUsername: 'quan_backup_bot',
      chatId: null,
      chatTitle: null,
      ready: false,
    });

    const chats = await client.telegram.chats({ body: {} });
    expect(chats.body).toEqual([
      { id: '-1001234', title: 'Sao lưu quán', type: 'supergroup' },
      { id: '555', title: 'Chủ Quán', type: 'private' },
    ]);
    const set = await client.telegram.setChat({ body: { chatId: '-1001234', title: 'Sao lưu quán' } });
    expect(set.body).toMatchObject({ ready: true, chatTitle: 'Sao lưu quán' });
    expect(tg.sent[0]).toMatchObject({ method: 'sendMessage', chatId: '-1001234' });

    const run = await client.backups.run({ body: {} });
    const s = run.body as { issue: string | null; last: { file: string; telegram: { ok: boolean } } };
    expect(s.last.telegram).toEqual({ ok: true, error: null });
    expect(s.issue).toBeNull();
    expect(tg.sent[1]).toMatchObject({ method: 'sendDocument', chatId: '-1001234', fileName: s.last.file });
    expect(tg.sent[1]!.bytes).toBeGreaterThan(1000);

    // Sealed in the database, never in responses or the audit log.
    const row = await prisma.setting.findUniqueOrThrow({ where: { key: 'telegram' } });
    expect(JSON.stringify(row.value)).not.toContain(TOKEN);
    expect(JSON.stringify((await client.telegram.status()).body)).not.toContain('AAH');
    expect(JSON.stringify(await prisma.auditLog.findMany())).not.toContain('AAH');
  });

  it('a failed send keeps the backup and raises the warning; can be turned off', async () => {
    const { client } = await makeUser({ username: 'chu', role: 'ADMIN' });
    mockTelegram();
    await client.telegram.saveToken({ body: { botToken: TOKEN } });
    await client.telegram.setChat({ body: { chatId: '555', title: 'Chủ Quán' } });

    vi.restoreAllMocks();
    const tg = mockTelegram({ sendFails: true });
    const s = (await client.backups.run({ body: {} })).body as {
      issue: string;
      last: { ok: boolean; telegram: { ok: boolean; error: string } };
    };
    expect(s.last.ok).toBe(true);
    expect(s.last.telegram.ok).toBe(false);
    expect(s.last.telegram.error).toContain('chat not found');
    expect(s.issue).toBe('TELEGRAM_FAILED');
    expect((await client.reports.dashboard()).body).toMatchObject({ alerts: { backup: 'TELEGRAM_FAILED' } });

    await client.settings.update({ body: { settings: { backup_telegram: false } } });
    const off = (await client.backups.run({ body: {} })).body as {
      issue: string | null;
      last: { telegram: null };
    };
    expect(off.last.telegram).toBeNull();
    expect(off.issue).toBeNull();
    expect(tg.sent.filter((x) => x.method === 'sendDocument')).toHaveLength(0);
  });

  it('a revoked token is reported clearly; ADMIN only', async () => {
    const { client } = await makeUser({ username: 'chu', role: 'ADMIN' });
    const staff = await makeUser({ username: 'thungan', role: 'STAFF' });
    mockTelegram({ tokenOk: false });
    const bad = await client.telegram.saveToken({ body: { botToken: TOKEN } });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toContain('Telegram không nhận mã bot');
    expect((await staff.client.telegram.status()).status).toBe(403);
  });
});

type Client = ReturnType<typeof clientFor>;
const jpeg = (seed: string) =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`JFIF ${seed} `.repeat(20))]).toString(
    'base64',
  );

async function fileDocument(client: Client, partner: string, fileName: string) {
  const doc = await client.documents.create({
    body: {
      kind: 'PURCHASE',
      date: '2026-10-03',
      number: '0004512',
      partner,
      amount: '1250000',
      note: null,
      receiptId: null,
    },
  });
  const id = (doc.body as { id: number }).id;
  await client.documents.addFile({
    params: { id },
    body: { name: fileName, dataBase64: jpeg(fileName), thumbBase64: null },
  });
}

describe('invoice files to Telegram', () => {
  async function ready() {
    const { client } = await makeUser({ username: 'chu', role: 'ADMIN' });
    mockTelegram();
    await client.telegram.saveToken({ body: { botToken: TOKEN } });
    await client.telegram.setChat({ body: { chatId: '555', title: 'Chủ Quán' } });
    return client;
  }
  const docsSent = <T extends { method: string; fileName?: string }>(sent: T[]) =>
    sent.filter((x) => x.method === 'sendDocument' && !x.fileName!.endsWith('.dump'));

  it('each file is sent once, with a searchable caption, after the backup', async () => {
    const client = await ready();
    await fileDocument(client, 'Chợ Bình Điền', 'hoa-don-1.jpg');
    await fileDocument(client, 'Bia Sài Gòn', 'hoa-don-2.jpg');
    vi.restoreAllMocks();
    const tg = mockTelegram();

    await client.backups.run({ body: {} });
    await documentsIdle();
    const first = docsSent(tg.sent);
    expect(first.map((x) => x.fileName)).toEqual(['hoa-don-1.jpg', 'hoa-don-2.jpg']);
    expect(first[0]!.caption).toBe(
      '📄 03/10/2026 · Mua vào · Chợ Bình Điền · HĐ 0004512 · 1.250.000 đ\nhoa-don-1.jpg',
    );
    expect((await client.backups.status()).body).toMatchObject({
      documents: { enabled: true, last: { sent: 2, pending: 0, error: null } },
    });

    // Nothing new: nothing sent. A new file: only that one.
    await client.backups.run({ body: {} });
    await documentsIdle();
    expect(docsSent(tg.sent)).toHaveLength(2);
    await fileDocument(client, 'Chợ', 'hoa-don-3.jpg');
    await client.backups.run({ body: {} });
    await documentsIdle();
    expect(docsSent(tg.sent).map((x) => x.fileName)).toEqual([
      'hoa-don-1.jpg',
      'hoa-don-2.jpg',
      'hoa-don-3.jpg',
    ]);
  });

  it('a failure stops there and raises the warning; the next run resumes; a new chat gets everything again', async () => {
    const client = await ready();
    await fileDocument(client, 'A', 'a.jpg');
    await fileDocument(client, 'B', 'b.jpg');
    await fileDocument(client, 'C', 'c.jpg');
    vi.restoreAllMocks();
    let tg = mockTelegram({ failFile: 'b.jpg' });
    await client.backups.run({ body: {} });
    await documentsIdle();
    expect(docsSent(tg.sent).map((x) => x.fileName)).toEqual(['a.jpg']);
    const s = (await client.backups.status()).body as {
      issue: string;
      documents: { last: { sent: number; pending: number; error: string } };
    };
    expect(s.documents.last).toMatchObject({ sent: 1, pending: 2 });
    expect(s.documents.last.error).toContain('file rejected');
    expect(s.issue).toBe('TELEGRAM_FAILED');

    vi.restoreAllMocks();
    tg = mockTelegram();
    await client.backups.run({ body: {} });
    await documentsIdle();
    expect(docsSent(tg.sent).map((x) => x.fileName)).toEqual(['b.jpg', 'c.jpg']);
    expect((await client.backups.status()).body).toMatchObject({ issue: null });

    await client.telegram.setChat({ body: { chatId: '-1001234', title: 'Sao lưu quán' } });
    await client.backups.run({ body: {} });
    await documentsIdle();
    expect(
      docsSent(tg.sent)
        .filter((x) => x.chatId === '-1001234')
        .map((x) => x.fileName),
    ).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
  });

  it('files lost on disk come back from Telegram, checked against the original', async () => {
    const { client } = await makeUser({ username: 'chu', role: 'ADMIN' });
    mockTelegram({ corruptFile: 'b.jpg' });
    await client.telegram.saveToken({ body: { botToken: TOKEN } });
    await client.telegram.setChat({ body: { chatId: '555', title: 'Chủ Quán' } });
    await fileDocument(client, 'A', 'a.jpg');
    await fileDocument(client, 'B', 'b.jpg');
    await client.backups.run({ body: {} });
    await documentsIdle();
    await fileDocument(client, 'C', 'c.jpg'); // never sent

    // The server's disk is replaced: the database is back, the files are not.
    const rows = await prisma.documentFile.findMany({ orderBy: { id: 'asc' } });
    for (const f of rows) rmSync(storedPath(f.path), { force: true });
    expect((await client.telegram.restoreStatus()).body).toEqual({ missing: 3, restorable: 2 });

    const r = (await client.telegram.restore({ body: {} })).body as {
      restored: number;
      failed: { name: string; message: string }[];
      remaining: number;
    };
    expect(r).toMatchObject({ restored: 1, remaining: 1, failed: [{ name: 'b.jpg' }] });
    expect(r.failed[0]!.message).toContain('không khớp');
    expect(readFileSync(storedPath(rows[0]!.path)).equals(Buffer.from(jpeg('a.jpg'), 'base64'))).toBe(true);
    expect((await client.telegram.restoreStatus()).body).toEqual({ missing: 2, restorable: 1 });
  });

  it('turned off: no invoice files are sent', async () => {
    const client = await ready();
    await fileDocument(client, 'A', 'a.jpg');
    await client.settings.update({ body: { settings: { backup_telegram_documents: false } } });
    vi.restoreAllMocks();
    const tg = mockTelegram();
    await client.backups.run({ body: {} });
    await documentsIdle();
    expect(docsSent(tg.sent)).toHaveLength(0);
  });
});
