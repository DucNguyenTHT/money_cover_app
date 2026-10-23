import { vi } from 'vitest';

export const TOKEN = '123456789:AAHfake-token-for-tests-0123456789abcd';

export interface SentToTelegram {
  method: string;
  chatId: string;
  text?: string;
  parseMode?: string;
  fileName?: string;
  bytes?: number;
  caption?: string;
}

/**
 * Fake Telegram Bot API: records what the bot sent and keeps the files (getFile / download).
 * `offline`: every call fails like a server without Internet.
 */
export function mockTelegram(
  opts: {
    tokenOk?: boolean;
    sendFails?: boolean;
    failFile?: string;
    corruptFile?: string;
    offline?: boolean;
  } = {},
) {
  const realFetch = globalThis.fetch;
  const files = new Map<string, Buffer>();
  const sent: SentToTelegram[] = [];
  const json = (v: unknown, status = 200) =>
    new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (!url.startsWith('https://api.telegram.org/')) return realFetch(input, init);
    if (opts.offline) throw new TypeError('fetch failed');
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
      const b = JSON.parse(String(init?.body)) as { chat_id: string; text: string; parse_mode?: string };
      sent.push({ method, chatId: String(b.chat_id), text: b.text, parseMode: b.parse_mode });
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
