import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, FileCheck2, Search } from 'lucide-react';
import type { EInvoiceConfig } from '@ketoan/api/contracts';
import { Button } from '@/components/ui/Button';
import { Card, Segmented, Select, Switch } from '@/components/ui/controls';
import { Field, Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { FormError } from '@/auth/AuthCard';
import { client, errorMessage, ok } from '@/lib/api-client';

type Choice = 'OFF' | 'MOCK' | 'SEPAY';
type Account = Awaited<ReturnType<typeof client.einvoice.accounts>>['body'];

const when = (iso: string) => {
  const d = new Date(Date.parse(iso) + 7 * 3600_000).toISOString();
  return `${d.slice(11, 16)} ${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
};

/**
 * Settings card: e-invoices generated from the till (hoá đơn khởi tạo từ máy tính tiền). The provider is picked here
 * — "Giả lập" tries the whole flow without sending anything to the tax authority.
 */
export function EInvoiceSection() {
  const qc = useQueryClient();
  const toast = useToast();
  const cfg = useQuery({
    queryKey: ['einvoice', 'config'],
    queryFn: async () => ok(await client.einvoice.config()),
  });
  const [choice, setChoice] = useState<Choice>('OFF');
  const [mode, setMode] = useState<'AUTO' | 'MANUAL'>('AUTO');
  const [sandbox, setSandbox] = useState(true);
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [accountId, setAccountId] = useState('');
  const [template, setTemplate] = useState('');
  const [accounts, setAccounts] = useState<Account | null>(null);

  useEffect(() => {
    const c = cfg.data;
    if (!c?.configured) return;
    setChoice(c.enabled ? (c.provider ?? 'OFF') : 'OFF');
    setMode(c.mode);
    setSandbox(c.sandbox);
    setClientId(c.clientId ?? '');
    setAccountId(c.providerAccountId ?? '');
    setTemplate(c.templateCode && c.invoiceSeries ? `${c.templateCode}|${c.invoiceSeries}` : '');
  }, [cfg.data]);

  const provider = choice === 'OFF' ? (cfg.data?.provider ?? 'MOCK') : choice;
  const [templateCode, invoiceSeries] = template ? template.split('|') : [null, null];

  const done = (msg: string) => (c: EInvoiceConfig) => {
    qc.setQueryData(['einvoice', 'config'], c);
    qc.invalidateQueries({ queryKey: ['einvoice', 'pos'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    setSecret('');
    toast(msg);
  };
  const save = useMutation({
    mutationFn: async () =>
      ok(
        await client.einvoice.saveConfig({
          body: {
            provider,
            enabled: choice !== 'OFF',
            mode,
            sandbox,
            clientId: clientId.trim() || null,
            clientSecret: secret.trim() || undefined,
            providerAccountId: accountId || null,
            templateCode: templateCode ?? null,
            invoiceSeries: invoiceSeries ?? null,
          },
        }),
      ),
    onSuccess: (c) =>
      done(
        !c.enabled
          ? 'Đã tắt hoá đơn điện tử'
          : c.provider === 'MOCK'
            ? 'Đã bật hoá đơn điện tử giả lập — thử thanh toán một đơn'
            : 'Đã bật hoá đơn điện tử',
      )(c),
  });
  const findAccounts = useMutation({
    mutationFn: async () =>
      ok(
        await client.einvoice.accounts({
          body: {
            provider: 'SEPAY',
            sandbox,
            clientId: clientId.trim() || null,
            clientSecret: secret.trim() || undefined,
          },
        }),
      ),
    onSuccess: (list) => {
      setAccounts(list);
      if (list.length === 1) setAccountId(list[0]!.id);
      if (!list.length) toast('Chưa có tài khoản nhà cung cấp nào trên SePay', 'bad');
    },
    onError: (e) => toast(errorMessage(e), 'bad'),
  });

  const c = cfg.data;
  const account = accounts?.find((a) => a.id === accountId);
  const canSave =
    choice !== 'SEPAY' ||
    (!!clientId.trim() && (!!secret.trim() || !!c?.hasSecret) && !!accountId && !!template);

  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 font-semibold text-ink-strong">
        <FileCheck2 size={18} className="text-primary-ink" /> Hoá đơn điện tử (khởi tạo từ máy tính tiền)
      </h2>
      <p className="mt-0.5 text-[13px] text-muted">
        Mỗi đơn thanh toán được gửi sang nhà cung cấp hoá đơn điện tử để phát hành và chuyển cơ quan thuế;
        bill in kèm số hoá đơn và mã QR tra cứu. Mất mạng thì hoá đơn chờ và tự gửi lại. Đơn đã phát hành bị
        huỷ → app tự lập hoá đơn điều chỉnh giảm. Cần hợp đồng với nhà cung cấp và đã đăng ký dùng hoá đơn với
        cơ quan thuế.
      </p>

      {c?.enabled && (
        <div
          className={`mt-4 flex items-start gap-2 rounded-ctl px-3 py-2.5 text-[13px] ${
            c.lastError ? 'bg-warn-soft text-warn' : 'bg-good-soft text-good'
          }`}
        >
          {c.lastError ? (
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          ) : (
            <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          )}
          <div className="flex flex-col gap-0.5">
            <span>
              Đang dùng:{' '}
              {c.provider === 'MOCK'
                ? 'Giả lập (không gửi cơ quan thuế)'
                : `SePay eInvoice${c.sandbox ? ' — môi trường thử' : ''}`}
              {c.invoiceSeries ? ` · ký hiệu ${c.invoiceSeries}` : ''} ·{' '}
              {c.mode === 'AUTO' ? 'tự xuất mọi đơn' : 'xuất khi khách lấy'}
            </span>
            {c.lastOkAt && <span>Phát hành gần nhất: {when(c.lastOkAt)}</span>}
            {c.lastError && <span>Lỗi gần nhất: {c.lastError}</span>}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Nhà cung cấp</span>
          <div>
            <Segmented
              label="Nhà cung cấp hoá đơn điện tử"
              value={choice}
              onChange={setChoice}
              options={[
                { value: 'OFF', label: 'Tắt' },
                { value: 'MOCK', label: 'Giả lập (để thử)' },
                { value: 'SEPAY', label: 'SePay eInvoice' },
              ]}
            />
          </div>
          <span className="text-xs text-faint">
            {choice === 'MOCK'
              ? 'Hoá đơn giả, số bắt đầu bằng GL, bill ghi "giả lập": thử toàn bộ quy trình trước khi ký hợp đồng.'
              : choice === 'SEPAY'
                ? 'SePay kết nối tới nhà cung cấp hoá đơn bạn đăng ký với họ. Nhà cung cấp khác (Viettel, MISA, VNPT…): cần tài liệu API và tài khoản thử của họ để thêm vào app.'
                : 'Không xuất hoá đơn điện tử.'}
          </span>
        </div>

        {choice !== 'OFF' && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">Khi nào xuất</span>
            <div>
              <Segmented
                label="Khi nào xuất hoá đơn"
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'AUTO', label: 'Mọi đơn khi thanh toán' },
                  { value: 'MANUAL', label: 'Chỉ khi khách lấy' },
                ]}
              />
            </div>
            <span className="text-xs text-faint">
              Hộ kinh doanh doanh thu trên 1 tỷ dùng hoá đơn từ máy tính tiền nên chọn “Mọi đơn khi thanh
              toán”.
            </span>
          </div>
        )}

        {choice === 'SEPAY' && (
          <div className="grid gap-4 rounded-card border border-line p-4 sm:grid-cols-2">
            <Field label="Client ID" hint="Do SePay cấp khi đăng ký eInvoice API">
              {(id, d) => (
                <Input
                  id={id}
                  aria-describedby={d}
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                />
              )}
            </Field>
            <Field
              label="Client Secret"
              hint={
                c?.hasSecret && c.provider === 'SEPAY'
                  ? 'Để trống = giữ mã đã lưu (mã hoá, không hiện lại)'
                  : undefined
              }
            >
              {(id, d) => (
                <Input
                  id={id}
                  aria-describedby={d}
                  type="password"
                  autoComplete="off"
                  placeholder={c?.hasSecret ? '••••••••' : ''}
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                />
              )}
            </Field>
            <div className="sm:col-span-2">
              <Switch
                checked={sandbox}
                onChange={setSandbox}
                label="Môi trường thử (sandbox)"
                description="Hoá đơn không gửi cơ quan thuế — tắt khi dùng thật"
              />
            </div>
            <div className="flex flex-col gap-2 sm:col-span-2">
              <div>
                <Button
                  icon={<Search size={16} />}
                  loading={findAccounts.isPending}
                  disabled={!clientId.trim() || (!secret.trim() && !c?.hasSecret)}
                  onClick={() => findAccounts.mutate()}
                >
                  Lấy danh sách mẫu hoá đơn
                </Button>
              </div>
              {(accounts || accountId) && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Tài khoản nhà cung cấp">
                    {(id) => (
                      <Select id={id} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                        <option value="">— chọn —</option>
                        {(
                          accounts ??
                          (accountId
                            ? [{ id: accountId, provider: 'đã lưu', active: true, templates: [] }]
                            : [])
                        ).map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.provider}
                            {a.active ? '' : ' (ngừng)'} · {a.id.slice(0, 8)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field label="Mẫu / ký hiệu hoá đơn">
                    {(id) => (
                      <Select id={id} value={template} onChange={(e) => setTemplate(e.target.value)}>
                        <option value="">— chọn —</option>
                        {template &&
                          !account?.templates.some(
                            (t) => `${t.templateCode}|${t.invoiceSeries}` === template,
                          ) && <option value={template}>{template.replace('|', ' - ')} (đã lưu)</option>}
                        {account?.templates.map((t) => (
                          <option
                            key={`${t.templateCode}|${t.invoiceSeries}`}
                            value={`${t.templateCode}|${t.invoiceSeries}`}
                          >
                            {t.label}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <FormError message={save.error ? errorMessage(save.error) : null} />
      <div className="mt-4">
        <Button variant="primary" loading={save.isPending} disabled={!canSave} onClick={() => save.mutate()}>
          {choice === 'OFF' ? 'Lưu' : 'Lưu & kiểm tra'}
        </Button>
      </div>
    </Card>
  );
}
