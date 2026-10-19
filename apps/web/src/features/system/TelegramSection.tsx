import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, Search, Send } from 'lucide-react';
import type { TelegramChat } from '@ketoan/api/contracts';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/controls';
import { Field, Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { FormError } from '@/auth/AuthCard';
import { client, errorMessage, ok } from '@/lib/api-client';

const CHAT_TYPE: Record<string, string> = {
  private: 'chat riêng',
  group: 'nhóm',
  supergroup: 'nhóm',
  channel: 'kênh',
};

/** Settings card: Telegram bot that receives every backup file. */
export function TelegramSection() {
  const qc = useQueryClient();
  const toast = useToast();
  const status = useQuery({
    queryKey: ['telegram'],
    queryFn: async () => ok(await client.telegram.status()),
  });
  const [token, setToken] = useState('');
  const [editing, setEditing] = useState(false);
  const [found, setFound] = useState<TelegramChat[] | null>(null);
  const done = (msg: string) => (s: Awaited<ReturnType<typeof client.telegram.status>>['body']) => {
    qc.setQueryData(['telegram'], s);
    qc.invalidateQueries({ queryKey: ['backups'] });
    toast(msg);
  };

  const saveToken = useMutation({
    mutationFn: async () => ok(await client.telegram.saveToken({ body: { botToken: token.trim() } })),
    onSuccess: (s) => {
      done(`Đã lưu bot @${s.botUsername}`)(s);
      setToken('');
      setEditing(false);
      setFound(null);
    },
  });
  const findChats = useMutation({
    mutationFn: async () => ok(await client.telegram.chats({ body: {} })),
    onSuccess: setFound,
    onError: (e) => toast(errorMessage(e), 'bad'),
  });
  const setChat = useMutation({
    mutationFn: async (c: TelegramChat) =>
      ok(await client.telegram.setChat({ body: { chatId: c.id, title: c.title } })),
    onSuccess: (s) => {
      done(`Đã chọn "${s.chatTitle}" — kiểm tra tin nhắn thử trên Telegram`)(s);
      setFound(null);
    },
    onError: (e) => toast(errorMessage(e), 'bad'),
  });
  const clear = useMutation({
    mutationFn: async () => ok(await client.telegram.clear({ body: {} })),
    onSuccess: done('Đã gỡ bot Telegram'),
    onError: (e) => toast(errorMessage(e), 'bad'),
  });

  const s = status.data;
  const showToken = editing || (s && !s.botUsername);

  return (
    <Card className="p-5">
      <h2 className="font-semibold text-ink-strong">Telegram</h2>
      <p className="mt-0.5 text-[13px] text-muted">
        Mỗi bản sao lưu dữ liệu được gửi vào một cuộc trò chuyện Telegram của bạn (miễn phí, mỗi file tối đa
        50 MB). Mở Telegram trên điện thoại là thấy; khi cần khôi phục thì tải file về.
      </p>

      {s && (
        <div className="mt-4 flex flex-col gap-4">
          {showToken ? (
            <div className="flex flex-col gap-3">
              <ol className="flex list-decimal flex-col gap-1 pl-5 text-[13px] text-muted">
                <li>
                  Mở Telegram, tìm{' '}
                  <a
                    className="text-primary-ink underline"
                    href="https://t.me/BotFather"
                    target="_blank"
                    rel="noreferrer"
                  >
                    @BotFather <ExternalLink size={12} className="inline" />
                  </a>{' '}
                  → gửi <code>/newbot</code> → đặt tên (vd “Sao lưu quán”) và username kết thúc bằng{' '}
                  <code>bot</code>.
                </li>
                <li>
                  BotFather trả về một mã dạng <code>123456789:AAH…</code> — dán vào ô dưới đây rồi bấm Lưu.
                </li>
              </ol>
              <Field label="Mã bot (token)" hint="Được mã hoá khi lưu, không hiện lại">
                {(id, d) => (
                  <Input
                    id={id}
                    aria-describedby={d}
                    type="password"
                    autoComplete="off"
                    placeholder="123456789:AAH…"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                  />
                )}
              </Field>
              <FormError message={saveToken.error ? errorMessage(saveToken.error) : null} />
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  loading={saveToken.isPending}
                  disabled={!token.trim()}
                  onClick={() => saveToken.mutate()}
                >
                  Lưu
                </Button>
                {editing && <Button onClick={() => setEditing(false)}>Huỷ</Button>}
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
              <span>
                Bot: <b className="text-ink">@{s.botUsername}</b>
              </span>
              <span className="flex gap-2">
                <Button size="sm" onClick={() => setEditing(true)}>
                  Đổi bot
                </Button>
                <Button size="sm" variant="ghost" loading={clear.isPending} onClick={() => clear.mutate()}>
                  Gỡ
                </Button>
              </span>
            </div>
          )}

          {s.botUsername && !editing && (
            <div className="flex flex-col gap-3 rounded-card border border-line p-4 text-[13px]">
              {s.ready && (
                <span className="inline-flex items-center gap-1.5 text-good">
                  <CheckCircle2 size={16} /> Gửi bản sao lưu vào: <b>{s.chatTitle}</b>
                </span>
              )}
              <p className="text-muted">
                {s.ready ? 'Đổi nơi nhận: ' : 'Chọn nơi nhận bản sao lưu: '}
                trên Telegram mở{' '}
                <a
                  className="text-primary-ink underline"
                  href={`https://t.me/${s.botUsername}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  @{s.botUsername}
                </a>{' '}
                và bấm <b>Start</b> (hoặc thêm bot vào một nhóm riêng rồi gửi một tin bất kỳ trong nhóm), sau
                đó bấm Tìm.
              </p>
              <div>
                <Button
                  icon={<Search size={16} />}
                  loading={findChats.isPending}
                  onClick={() => findChats.mutate()}
                >
                  Tìm cuộc trò chuyện
                </Button>
              </div>
              {found && found.length === 0 && (
                <p className="text-warn">
                  Chưa thấy tin nào gửi cho bot. Gửi một tin cho @{s.botUsername} rồi bấm Tìm lại.
                </p>
              )}
              {found && found.length > 0 && (
                <ul className="flex flex-col gap-1.5">
                  {found.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">
                        {c.title} <span className="text-faint">· {CHAT_TYPE[c.type] ?? c.type}</span>
                      </span>
                      <Button
                        size="sm"
                        variant="tonal"
                        icon={<Send size={14} />}
                        loading={setChat.isPending && setChat.variables?.id === c.id}
                        onClick={() => setChat.mutate(c)}
                      >
                        Chọn & gửi thử
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
