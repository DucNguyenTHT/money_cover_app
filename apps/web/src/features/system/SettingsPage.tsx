import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import type { Settings } from '@ketoan/api/contracts';
import type { Channel } from '@ketoan/api/domain';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, Segmented, Select, Switch } from '@/components/ui/controls';
import { Field, Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { FormError } from '@/auth/AuthCard';
import { BackupSection } from './BackupSection';
import { BankFeedSection } from './BankFeedSection';
import { GoogleDriveSection } from './GoogleDriveSection';
import { NotifySection } from './NotifySection';
import { TelegramSection } from './TelegramSection';
import { client, errorMessage, ok } from '@/lib/api-client';
import { cn } from '@/lib/cn';

type Branch = { name: string; address: string; phone: string };
const CHANNEL_LABEL: Record<Channel, string> = {
  DINE_IN: 'Tại bàn',
  TAKEAWAY: 'Mang về',
  APP: 'App giao hàng',
};

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Card className="p-5">
      <h2 className="font-semibold text-ink-strong">{title}</h2>
      {hint && <p className="mb-4 mt-0.5 text-[13px] text-muted">{hint}</p>}
      <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </Card>
  );
}

export function SettingsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const query = useQuery({ queryKey: ['settings'], queryFn: async () => ok(await client.settings.get()) });
  // Rate the pricing pages actually use (automatic, or the manual fallback) and why.
  const overhead = useQuery({
    queryKey: ['pricing', 'overhead'],
    queryFn: async () => ok(await client.pricing.overhead()),
  });
  const [branch, setBranch] = useState<Branch | null>(null);
  const [s, setS] = useState<Settings | null>(null);

  useEffect(() => {
    if (query.data) {
      setBranch(query.data.branch);
      setS(query.data.settings);
    }
  }, [query.data]);

  const save = useMutation({
    mutationFn: async () => ok(await client.settings.update({ body: { branch: branch!, settings: s! } })),
    onSuccess: (data) => {
      qc.setQueryData(['settings'], data);
      qc.invalidateQueries({ queryKey: ['pricing'] });
      toast('Đã lưu cài đặt');
    },
  });

  if (!s || !branch) return <PageHeader title="Cài đặt" subtitle="Đang tải…" />;

  const num = (k: keyof Settings) => ({
    value: String(s[k]),
    onChange: (e: { target: { value: string } }) =>
      setS({ ...s, [k]: e.target.value.replace(',', '.') } as Settings),
  });
  const text = (k: keyof Settings) => ({
    value: String(s[k]),
    onChange: (e: { target: { value: string } }) => setS({ ...s, [k]: e.target.value } as Settings),
  });
  const toggleChannel = (c: Channel) =>
    setS({
      ...s,
      service_charge_channels: s.service_charge_channels.includes(c)
        ? s.service_charge_channels.filter((x) => x !== c)
        : [...s.service_charge_channels, c],
    });

  return (
    <div className="pb-20">
      <PageHeader
        title="Cài đặt"
        actions={
          <Button
            variant="primary"
            icon={<Save size={16} />}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            Lưu cài đặt
          </Button>
        }
      />
      <div className="flex flex-col gap-4">
        <FormError message={save.error ? errorMessage(save.error) : null} />

        <Section title="Thông tin quán" hint="In trên đầu hoá đơn">
          <Field label="Tên quán">
            {(id) => (
              <Input
                id={id}
                value={branch.name}
                onChange={(e) => setBranch({ ...branch, name: e.target.value })}
              />
            )}
          </Field>
          <Field label="Địa chỉ">
            {(id) => (
              <Input
                id={id}
                value={branch.address}
                onChange={(e) => setBranch({ ...branch, address: e.target.value })}
              />
            )}
          </Field>
          <Field label="Điện thoại">
            {(id) => (
              <Input
                id={id}
                value={branch.phone}
                onChange={(e) => setBranch({ ...branch, phone: e.target.value })}
              />
            )}
          </Field>
          <div className="sm:col-span-2 lg:col-span-3">
            <Field label="Lời chào cuối hoá đơn">{(id) => <Input id={id} {...text('bill_footer')} />}</Field>
          </div>
        </Section>

        <Section
          title="Bán hàng"
          hint="Giờ bắt đầu ngày kinh doanh: đơn trước giờ này được tính vào ngày hôm trước (VD quán mở khuya)"
        >
          <Field label="Giờ bắt đầu ngày kinh doanh">
            {(id) => <Input id={id} type="time" {...text('business_day_start')} />}
          </Field>
          <Field label="Giảm giá tối đa nhân viên tự làm (%)" hint="Vượt mức này cần ADMIN nhập PIN">
            {(id, d) => (
              <Input
                id={id}
                aria-describedby={d}
                inputMode="decimal"
                className="num text-right"
                {...num('max_discount_pct')}
              />
            )}
          </Field>
        </Section>

        <Section
          title="Thuế & phụ thu"
          hint="Chọn đúng loại hình đăng ký với cơ quan thuế. Phụ thu (phí phục vụ) tính vào doanh thu."
        >
          <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-3">
            <span className="text-[13px] font-medium">Loại hình nộp thuế</span>
            <div>
              <Segmented
                label="Loại hình nộp thuế"
                value={s.tax_regime}
                onChange={(v) => setS({ ...s, tax_regime: v })}
                options={[
                  { value: 'HOUSEHOLD', label: 'Hộ kinh doanh' },
                  { value: 'DEDUCTION', label: 'Công ty (khấu trừ thuế)' },
                ]}
              />
            </div>
            <p className="text-xs text-faint">
              {s.tax_regime === 'HOUSEHOLD'
                ? 'Hộ kinh doanh không ghi VAT trên bill. Doanh thu năm trên 1 tỷ: thuế GTGT = doanh thu × tỷ lệ ngành (ăn uống 3%, đến hết 2026 còn 2,4%) và thuế TNCN — app tạm tính ở Báo cáo → Thuế phải nộp. Ngành thuế đặt theo từng nhóm món.'
                : 'Công ty ghi VAT trên bill theo thuế suất bên dưới (8% đến hết 31/12/2026, sau đó 10% nếu không gia hạn). VAT là tiền thu hộ, không tính vào doanh thu.'}
            </p>
          </div>
          {s.tax_regime === 'HOUSEHOLD' ? (
            <>
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium">Cách tính thuế TNCN</span>
                <div>
                  <Segmented
                    label="Cách tính thuế TNCN"
                    value={s.household_pit_method}
                    onChange={(v) => setS({ ...s, household_pit_method: v })}
                    options={[
                      { value: 'INCOME', label: 'Theo lãi' },
                      { value: 'REVENUE', label: 'Theo doanh thu' },
                    ]}
                  />
                </div>
                <span className="text-xs text-faint">
                  {s.household_pit_method === 'INCOME'
                    ? 'Lãi × 15% (doanh thu 1–3 tỷ), 17% (3–50 tỷ). Cần chứng từ chi phí đầy đủ.'
                    : '(Doanh thu − 1 tỷ) × tỷ lệ ngành (ăn uống 1,5%). Chỉ dùng được khi doanh thu năm dưới 3 tỷ.'}
                </span>
              </div>
              <div className="sm:col-span-1 lg:col-span-2">
                <Switch
                  checked={s.einvoice_registered}
                  onChange={(v) => setS({ ...s, einvoice_registered: v })}
                  label="Đã đăng ký hoá đơn điện tử khởi tạo từ máy tính tiền"
                  description="Bắt buộc khi doanh thu năm trên 1 tỷ (đăng ký trong 30 ngày kể từ khi vượt). App nhắc trên bảng điều khiển khi chưa bật."
                />
              </div>
            </>
          ) : (
            <>
              <Field label="Thuế VAT (%)" hint="8 đến hết 31/12/2026; 0 nếu không thu VAT">
                {(id, d) => (
                  <Input
                    id={id}
                    aria-describedby={d}
                    inputMode="decimal"
                    className="num text-right"
                    {...num('vat_pct')}
                  />
                )}
              </Field>
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium">Cách tính VAT</span>
                <Segmented
                  label="Cách tính VAT"
                  value={s.vat_mode}
                  onChange={(v) => setS({ ...s, vat_mode: v })}
                  options={[
                    { value: 'EXCLUSIVE', label: 'Cộng thêm vào bill' },
                    { value: 'INCLUSIVE', label: 'Đã gồm trong giá' },
                  ]}
                />
              </div>
            </>
          )}
          <Field label="Phụ thu / phí phục vụ (%)">
            {(id) => (
              <Input id={id} inputMode="decimal" className="num text-right" {...num('service_charge_pct')} />
            )}
          </Field>
          <fieldset className="flex flex-col gap-2 sm:col-span-2 lg:col-span-3">
            <legend className="mb-1.5 text-[13px] font-medium">Áp dụng phụ thu cho kênh</legend>
            <div className="flex flex-wrap gap-4">
              {(Object.keys(CHANNEL_LABEL) as Channel[]).map((c) => (
                <label key={c} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--color-primary)]"
                    checked={s.service_charge_channels.includes(c)}
                    onChange={() => toggleChannel(c)}
                  />
                  {CHANNEL_LABEL[c]}
                </label>
              ))}
            </div>
          </fieldset>
        </Section>

        <Section
          title="Chuyển khoản (VietQR)"
          hint="Mã QR đúng số tiền hiện khi thanh toán chuyển khoản và in trên hoá đơn. Để trống nếu không dùng."
        >
          <Field label="Mã BIN ngân hàng" hint="6 số, VD Vietcombank 970436">
            {(id, d) => (
              <Input id={id} aria-describedby={d} inputMode="numeric" className="num" {...text('bank_bin')} />
            )}
          </Field>
          <Field label="Số tài khoản">
            {(id) => <Input id={id} className="num" {...text('bank_account_no')} />}
          </Field>
          <Field label="Tên chủ tài khoản">{(id) => <Input id={id} {...text('bank_account_name')} />}</Field>
        </Section>

        <div id="bank-feed" className="scroll-mt-20">
          <BankFeedSection />
        </div>

        <Section title="Giá vốn & giá bán" hint="Dùng cho bảng tính giá và cảnh báo khi giá nhập tăng">
          <Field label="% nguyên liệu / giá bán mục tiêu (mặc định)">
            {(id) => (
              <Input
                id={id}
                inputMode="decimal"
                className="num text-right"
                {...num('food_cost_target_default')}
              />
            )}
          </Field>
          <Field label="Ngưỡng cảnh báo vượt mục tiêu (%)">
            {(id) => (
              <Input id={id} inputMode="decimal" className="num text-right" {...num('alert_tolerance_pct')} />
            )}
          </Field>
          <Field label="Làm tròn giá gợi ý lên bội số của">
            {(id) => (
              <Select
                id={id}
                value={String(s.price_rounding)}
                onChange={(e) => setS({ ...s, price_rounding: Number(e.target.value) })}
              >
                <option value="500">500 ₫</option>
                <option value="1000">1.000 ₫</option>
                <option value="5000">5.000 ₫</option>
              </Select>
            )}
          </Field>
          <Field label="Gợi ý nhập hàng đủ dùng (ngày)" hint="Kho → Cần nhập hàng">
            {(id, d) => (
              <Input
                id={id}
                aria-describedby={d}
                inputMode="numeric"
                className="num text-right"
                {...num('reorder_days')}
              />
            )}
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">Tỷ lệ chi phí chung</span>
            <Segmented
              label="Tỷ lệ chi phí chung"
              value={s.overhead_rate_mode}
              onChange={(v) => setS({ ...s, overhead_rate_mode: v })}
              options={[
                { value: 'AUTO', label: 'Tự tính (3 tháng)' },
                { value: 'MANUAL', label: 'Nhập tay' },
              ]}
            />
            {overhead.data && (
              <p className={cn('text-xs', overhead.data.warn ? 'text-warn' : 'text-faint')}>
                Đang dùng {overhead.data.pct.replace('.', ',')}%
                {overhead.data.source === 'MANUAL' ? ' (nhập tay)' : ' (tự tính)'}
                {overhead.data.note ? ` · ${overhead.data.note}` : ''}
              </p>
            )}
          </div>
          {/* The manual rate is also the fallback of the automatic one. */}
          {(s.overhead_rate_mode === 'MANUAL' || overhead.data?.source === 'MANUAL') && (
            <Field
              label={
                s.overhead_rate_mode === 'MANUAL'
                  ? 'Chi phí chung (% doanh số)'
                  : 'Chi phí chung dự phòng (% doanh số)'
              }
            >
              {(id) => (
                <Input
                  id={id}
                  inputMode="decimal"
                  className="num text-right"
                  {...num('overhead_rate_manual')}
                />
              )}
            </Field>
          )}
        </Section>

        <Section title="In">
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">Cách in hoá đơn & phiếu bếp</span>
            <Segmented
              label="Cách in"
              value={s.print_mode}
              onChange={(v) => setS({ ...s, print_mode: v })}
              options={[
                { value: 'SERVER', label: 'Qua mạng (khuyên dùng)' },
                { value: 'BROWSER', label: 'Trình duyệt' },
              ]}
            />
          </div>
        </Section>

        <div id="telegram" className="scroll-mt-20">
          <TelegramSection />
        </div>

        <NotifySection s={s} setS={setS} />

        <GoogleDriveSection />

        <BackupSection s={s} setS={setS} />
      </div>
    </div>
  );
}
