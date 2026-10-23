import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BellRing, CheckCircle2, Search, Send } from 'lucide-react';
import type { Settings, TelegramChat } from '@ketoan/api/contracts';
import { Button } from '@/components/ui/Button';
import { Card, Select, Switch } from '@/components/ui/controls';
import { Field, Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { client, errorMessage, ok } from '@/lib/api-client';
import { money } from '@/lib/format';

const when = (iso: string) =>
  new Date(iso).toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

/** Telegram HTML → plain text for the preview under the button. */
const plain = (html: string) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/** Settings card: the owner's reports and alerts on Telegram (switches are saved with "Lưu cài đặt"). */
export function NotifySection({ s, setS }: { s: Settings; setS: (s: Settings) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const tg = useQuery({ queryKey: ['telegram'], queryFn: async () => ok(await client.telegram.status()) });
  const queue = useQuery({
    queryKey: ['telegram', 'queue'],
    queryFn: async () => ok(await client.telegram.queue()),
    enabled: !!tg.data?.reportReady,
    refetchInterval: (q) => (q.state.data?.waiting ? 15_000 : false),
  });
  const [preview, setPreview] = useState<string | null>(null);
  const [found, setFound] = useState<TelegramChat[] | null>(null);

  const digest = useMutation({
    mutationFn: async () => ok(await client.telegram.sendDigest({ body: {} })),
    onSuccess: (r) => {
      setPreview(plain(r.text));
      toast('Đã gửi tin "Việc cần chú ý" — xem trên Telegram');
    },
    onError: (e) => toast(errorMessage(e), 'bad'),
  });
  const findChats = useMutation({
    mutationFn: async () => ok(await client.telegram.chats({ body: {} })),
    onSuccess: setFound,
    onError: (e) => toast(errorMessage(e), 'bad'),
  });
  const setChat = useMutation({
    mutationFn: async (c: TelegramChat | null) =>
      ok(
        await client.telegram.setReportChat({
          body: c ? { chatId: c.id, title: c.title } : { chatId: null, title: null },
        }),
      ),
    onSuccess: (st) => {
      qc.setQueryData(['telegram'], st);
      setFound(null);
      toast(
        st.reportChatId
          ? `Báo cáo & cảnh báo gửi vào "${st.reportChatTitle}" — kiểm tra tin nhắn thử`
          : 'Báo cáo & cảnh báo gửi cùng chỗ nhận sao lưu',
      );
    },
    onError: (e) => toast(errorMessage(e), 'bad'),
  });

  const t = tg.data;
  const q = queue.data;

  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 font-semibold text-ink-strong">
        <BellRing size={18} className="text-primary-ink" /> Báo cáo & cảnh báo qua Telegram
      </h2>
      <p className="mt-0.5 text-[13px] text-muted">
        Ở ngoài quán vẫn biết tình hình: báo cáo mỗi lần chốt ngày, tin nhắc việc buổi sáng và cảnh báo ngay
        khi có thao tác dễ gian lận. Máy chủ mất mạng thì tin chờ và tự gửi lại (trong 1 ngày).
      </p>

      {t && !t.botUsername && (
        <p className="mt-4 flex items-center gap-2 rounded-ctl bg-warn-soft px-3 py-2.5 text-[13px] text-warn">
          <AlertTriangle size={16} className="shrink-0" />
          <span>
            Cần cài bot ở mục{' '}
            <a className="underline" href="#telegram">
              Telegram
            </a>{' '}
            trước.
          </span>
        </p>
      )}

      {t?.botUsername && (
        <div className="mt-4 flex flex-col gap-2 rounded-card border border-line p-4 text-[13px]">
          <span className="inline-flex flex-wrap items-center gap-1.5">
            {t.reportReady ? (
              <CheckCircle2 size={16} className="text-good" />
            ) : (
              <AlertTriangle size={16} className="text-warn" />
            )}
            Gửi vào:{' '}
            <b>
              {t.reportChatId
                ? t.reportChatTitle
                : t.chatTitle
                  ? `${t.chatTitle} (cùng chỗ nhận sao lưu)`
                  : 'chưa chọn'}
            </b>
          </span>
          <p className="text-muted">
            Muốn quản lý xem báo cáo mà không nhận file dữ liệu: thêm bot vào một nhóm riêng, gửi một tin
            trong nhóm rồi bấm Tìm và chọn nhóm đó.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              icon={<Search size={14} />}
              loading={findChats.isPending}
              onClick={() => findChats.mutate()}
            >
              Chọn nơi khác
            </Button>
            {t.reportChatId && (
              <Button
                size="sm"
                variant="ghost"
                loading={setChat.isPending}
                onClick={() => setChat.mutate(null)}
              >
                Dùng chỗ nhận sao lưu
              </Button>
            )}
          </div>
          {found && found.length === 0 && (
            <p className="text-warn">Chưa thấy tin nào gửi cho bot. Gửi một tin cho bot rồi bấm lại.</p>
          )}
          {found && found.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {found.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">{c.title}</span>
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

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="flex flex-col gap-3 sm:col-span-2 lg:col-span-2">
          <Switch
            checked={s.notify_daily}
            onChange={(v) => setS({ ...s, notify_daily: v })}
            label="Báo cáo khi chốt ngày"
            description="Doanh thu, lãi gộp tạm tính, tiền theo hình thức, tiền két lệch bao nhiêu, đơn huỷ, giảm giá"
          />
          <Switch
            checked={s.notify_morning}
            onChange={(v) => setS({ ...s, notify_morning: v })}
            label="Tin nhắc việc buổi sáng"
            description="Ngày chưa chốt, hàng sắp hết, nợ kho, món đang lỗ, sao lưu lỗi, ngưỡng doanh thu thuế"
          />
          <Switch
            checked={s.notify_alerts}
            onChange={(v) => setS({ ...s, notify_alerts: v })}
            label="Cảnh báo ngay"
            description="Huỷ đơn đã thanh toán, giảm giá vượt mức (có ADMIN duyệt PIN), bán dưới giá vốn"
          />
        </div>
        <div className="flex flex-col gap-4">
          <Field label="Giờ gửi tin buổi sáng">
            {(id) => (
              <Select
                id={id}
                value={String(s.notify_morning_hour)}
                disabled={!s.notify_morning}
                onChange={(e) => setS({ ...s, notify_morning_hour: Number(e.target.value) })}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, '0')}:00
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Đánh dấu tiền két lệch từ (đồng)" hint="Báo cáo chốt ngày tô đậm và gắn ⚠️">
            {(id, d) => (
              <Input
                id={id}
                aria-describedby={d}
                inputMode="numeric"
                className="num text-right"
                value={money(s.notify_cash_diff)}
                onChange={(e) => setS({ ...s, notify_cash_diff: Number(e.target.value.replace(/\D/g, '')) })}
              />
            )}
          </Field>
        </div>
      </div>

      {t?.reportReady && (
        <div className="mt-4 flex flex-col gap-2 border-t border-line-soft pt-4 text-[13px]">
          <div className="flex flex-wrap items-center gap-3">
            <Button icon={<Send size={16} />} loading={digest.isPending} onClick={() => digest.mutate()}>
              Gửi thử tin “Việc cần chú ý”
            </Button>
            {q && (
              <span className={q.waiting ? 'text-warn' : 'text-faint'} aria-live="polite">
                {q.waiting
                  ? `Đang chờ gửi ${q.waiting} tin${q.lastError ? ` — ${q.lastError}` : ''}`
                  : q.lastSentAt
                    ? `Tin gần nhất gửi lúc ${when(q.lastSentAt)}`
                    : 'Chưa gửi tin nào'}
                {q.dropped ? ` · ${q.dropped} tin quá 1 ngày không gửi được đã bỏ` : ''}
              </span>
            )}
          </div>
          {preview && (
            <pre className="whitespace-pre-wrap rounded-ctl bg-page p-3 font-sans text-[13px] text-ink">
              {preview}
            </pre>
          )}
        </div>
      )}
    </Card>
  );
}
