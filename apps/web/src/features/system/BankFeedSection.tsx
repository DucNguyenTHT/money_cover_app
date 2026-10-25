import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ExternalLink, Landmark, RefreshCw } from 'lucide-react';
import type { BankFeedStatus } from '@ketoan/api/contracts';
import type { BankProvider } from '@ketoan/api/domain';
import { Button } from '@/components/ui/Button';
import { Card, Segmented, Switch } from '@/components/ui/controls';
import { Field, Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { FormError } from '@/auth/AuthCard';
import { client, errorMessage, ok } from '@/lib/api-client';

const when = (iso: string) =>
  new Date(iso).toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

const HELP: Record<BankProvider, { url: string; where: string }> = {
  SEPAY: {
    url: 'https://my.sepay.vn',
    where: 'my.sepay.vn → Cấu hình công ty → API Access (khoá API dài 64 ký tự)',
  },
  CASSO: {
    url: 'https://casso.vn',
    where: 'casso.vn → Tích hợp → API Key (mã bắt đầu bằng AK_)',
  },
};

/**
 * Settings card: read money arriving on the shop's account from SePay or Casso, so the till sees "đã nhận tiền"
 * by itself and day closing checks transfers like cash.
 */
export function BankFeedSection() {
  const qc = useQueryClient();
  const toast = useToast();
  const status = useQuery({
    queryKey: ['bank', 'status'],
    queryFn: async () => ok(await client.bank.status()),
  });
  const [provider, setProvider] = useState<BankProvider>('SEPAY');
  const [token, setToken] = useState('');
  const [sandbox, setSandbox] = useState(false);
  const [accountNo, setAccountNo] = useState('');
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    const s = status.data;
    if (!s?.configured) return;
    setProvider(s.provider ?? 'SEPAY');
    setSandbox(s.sandbox);
    setAccountNo(s.accountNo ?? '');
    setEnabled(s.enabled);
  }, [status.data]);

  const done = (msg: string) => (s: BankFeedStatus) => {
    qc.setQueryData(['bank', 'status'], s);
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    setToken('');
    toast(msg);
  };
  const save = useMutation({
    mutationFn: async () =>
      ok(
        await client.bank.saveConfig({
          body: {
            provider,
            token: token.trim() || undefined,
            sandbox,
            accountNo: accountNo.trim() || null,
            enabled,
          },
        }),
      ),
    onSuccess: (s) =>
      done(s.enabled ? 'Đã kết nối — app tự đọc tiền chuyển khoản về' : 'Đã lưu (đang tắt)')(s),
  });
  const clear = useMutation({
    mutationFn: async () => ok(await client.bank.clear({ body: {} })),
    onSuccess: done('Đã gỡ kết nối'),
    onError: (e) => toast(errorMessage(e), 'bad'),
  });
  const sync = useMutation({
    mutationFn: async () => ok(await client.bank.sync({ body: {} })),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['bank'] });
      toast(
        r.imported ? `Có ${r.imported} khoản tiền về, khớp được ${r.matched} đơn` : 'Không có tiền về mới',
      );
    },
    onError: (e) => {
      qc.invalidateQueries({ queryKey: ['bank', 'status'] });
      toast(errorMessage(e), 'bad');
    },
  });

  const s = status.data;
  const sameProvider = s?.configured && s.provider === provider;

  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 font-semibold text-ink-strong">
        <Landmark size={18} className="text-primary-ink" /> Tự xác nhận tiền chuyển khoản
      </h2>
      <p className="mt-0.5 text-[13px] text-muted">
        Nối với dịch vụ báo biến động số dư (SePay hoặc Casso) để app tự đọc tiền vào tài khoản của quán: mã
        VietQR mang mã đơn nên tiền về tự khớp đúng đơn, máy POS báo “đã nhận tiền” mà thu ngân không phải mở
        điện thoại, chốt ngày đối chiếu tiền chuyển khoản như tiền mặt. Cần Internet; đăng ký tài khoản dịch
        vụ và liên kết tài khoản ngân hàng ở trang của họ.
      </p>

      {s?.configured && (
        <div
          className={`mt-4 flex items-start gap-2 rounded-ctl px-3 py-2.5 text-[13px] ${
            s.lastError ? 'bg-warn-soft text-warn' : 'bg-good-soft text-good'
          }`}
        >
          {s.lastError ? (
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          ) : (
            <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          )}
          <div className="flex flex-col gap-0.5">
            <span>
              {s.provider === 'SEPAY' ? 'SePay' : 'Casso'}
              {s.sandbox ? ' (môi trường thử)' : ''} · {s.enabled ? 'đang bật' : 'đang tắt'}
              {s.accountNo ? ` · tài khoản ${s.accountNo}` : ''}
            </span>
            {s.lastOkAt && <span>Đọc thành công lần cuối: {when(s.lastOkAt)}</span>}
            {s.lastError && <span>Lỗi: {s.lastError}</span>}
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Dịch vụ</span>
          <div>
            <Segmented
              label="Dịch vụ báo số dư"
              value={provider}
              onChange={setProvider}
              options={[
                { value: 'SEPAY', label: 'SePay' },
                { value: 'CASSO', label: 'Casso' },
              ]}
            />
          </div>
          <span className="text-xs text-faint">
            {provider === 'SEPAY'
              ? 'Đọc được 3 lần / giây: máy POS báo tiền về sau vài giây.'
              : 'Gói rẻ nhất chỉ cho đọc 2 lần / phút: máy POS có thể báo chậm tới 30 giây.'}
          </span>
        </div>
        <Field
          label="Mã API"
          hint={
            sameProvider ? 'Để trống = giữ mã đã lưu (mã được mã hoá, không hiện lại)' : HELP[provider].where
          }
        >
          {(id, d) => (
            <Input
              id={id}
              aria-describedby={d}
              type="password"
              autoComplete="off"
              placeholder={sameProvider ? '••••••••' : 'Dán mã API'}
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          )}
        </Field>
        <Field label="Chỉ đọc tài khoản" hint="Để trống = tài khoản VietQR trong Cài đặt">
          {(id, d) => (
            <Input
              id={id}
              aria-describedby={d}
              className="num"
              value={accountNo}
              onChange={(e) => setAccountNo(e.target.value)}
            />
          )}
        </Field>
        <div className="flex flex-col gap-3 sm:col-span-2 lg:col-span-3">
          <Switch
            checked={enabled}
            onChange={setEnabled}
            label="Bật đọc tiền chuyển khoản"
            description="Mỗi phút một lần; dày hơn khi máy POS đang chờ khách chuyển tiền"
          />
          {provider === 'SEPAY' && (
            <Switch
              checked={sandbox}
              onChange={setSandbox}
              label="Môi trường thử của SePay (sandbox)"
              description="Giao dịch giả lập để thử, không phải tiền thật"
            />
          )}
          <a
            className="inline-flex items-center gap-1 text-[13px] text-primary-ink underline"
            href={HELP[provider].url}
            target="_blank"
            rel="noreferrer"
          >
            Mở trang {provider === 'SEPAY' ? 'SePay' : 'Casso'} <ExternalLink size={12} />
          </a>
        </div>
      </div>

      <FormError message={save.error ? errorMessage(save.error) : null} />
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="primary"
          loading={save.isPending}
          disabled={!sameProvider && !token.trim()}
          onClick={() => save.mutate()}
        >
          Lưu & kiểm tra
        </Button>
        {s?.enabled && (
          <Button icon={<RefreshCw size={16} />} loading={sync.isPending} onClick={() => sync.mutate()}>
            Đọc ngay
          </Button>
        )}
        {s?.configured && (
          <Button variant="ghost" loading={clear.isPending} onClick={() => clear.mutate()}>
            Gỡ kết nối
          </Button>
        )}
      </div>
    </Card>
  );
}
