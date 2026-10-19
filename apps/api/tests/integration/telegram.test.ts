import { rmSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/core/db';
import { makeUser, resetDb, startServer, stopServer } from '../helpers/harness';

const TOKEN = '123456789:AAHfake-token-for-tests-0123456789abcd';

beforeAll(startServer);
afterAll(stopServer);
beforeEach(async () => {
  await resetDb();
  rmSync(path.resolve('storage/test-backups'), { recursive: true, force: true });
});
afterEach(() => vi.restoreAllMocks());

/** Fake Telegram Bot API: records what the bot sent. */
function mockTelegram(opts: { tokenOk?: boolean; sendFails?: boolean } = {}) {
  const realFetch = globalThis.fetch;
  const sent: { method: string; chatId: string; text?: string; fileName?: string; bytes?: number }[] = [];
  const json = (v: unknown, status = 200) =>
    new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (!url.startsWith('https://api.telegram.org/')) return realFetch(input, init);
    if (!url.includes(`/bot${TOKEN}/`) || opts.tokenOk === false)
      return json({ ok: false, description: 'Unauthorized' }, 401);
    const method = url.split('/').pop()!;
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
      sent.push({ method, chatId: String(form.get('chat_id')), fileName: doc.name, bytes: doc.size });
      return json({ ok: true, result: { message_id: 2 } });
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
