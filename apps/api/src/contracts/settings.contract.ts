import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { CHANNELS, TAX_REGIMES, VAT_MODES } from '../domain/enums';
import { commonErrors, type RouteMeta } from './common';

const c = initContract();

const pct = (max = 100) => z.coerce.number().min(0, 'Không được âm').max(max, `Tối đa ${max}%`);

export const settingsSchema = z.object({
  food_cost_target_default: pct(),
  overhead_rate_mode: z.enum(['AUTO', 'MANUAL']),
  overhead_rate_manual: pct(),
  price_rounding: z.coerce.number().int().min(1).max(100_000),
  alert_tolerance_pct: pct(),
  max_discount_pct: pct(),
  business_day_start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Giờ dạng HH:mm'),
  bill_footer: z.string().max(200),
  vat_pct: pct(20),
  vat_mode: z.enum(VAT_MODES),
  service_charge_pct: pct(30),
  service_charge_channels: z.array(z.enum(CHANNELS)),
  bank_bin: z.string().regex(/^(\d{6})?$/, 'Mã BIN ngân hàng gồm 6 chữ số'),
  bank_account_no: z.string().regex(/^[0-9A-Za-z]{0,19}$/, 'Số tài khoản không hợp lệ'),
  bank_account_name: z.string().max(50),
  print_mode: z.enum(['SERVER', 'BROWSER']),
  /** HOUSEHOLD = hộ kinh doanh (thuế theo % doanh thu, không ghi VAT trên bill); DEDUCTION = công ty khấu trừ. */
  tax_regime: z.enum(TAX_REGIMES),
  /** Hộ kinh doanh: thuế TNCN theo lãi (INCOME) hay theo doanh thu (REVENUE). */
  household_pit_method: z.enum(['INCOME', 'REVENUE']),
  /** Đã đăng ký hoá đơn điện tử khởi tạo từ máy tính tiền (bắt buộc khi doanh thu năm trên 1 tỷ). */
  einvoice_registered: z.boolean(),
  /** Giờ (0–23) chạy sao lưu dữ liệu tự động mỗi ngày. */
  backup_hour: z.coerce.number().int().min(0).max(23),
  /** Gợi ý nhập hàng đủ dùng cho bao nhiêu ngày. */
  reorder_days: z.coerce.number().int().min(1).max(60),
  /** Đẩy mỗi bản sao lưu lên Google Drive đã kết nối. */
  backup_drive: z.boolean(),
  /** Gửi mỗi bản sao lưu vào cuộc trò chuyện Telegram đã chọn. */
  backup_telegram: z.boolean(),
  /** Gửi thêm từng file chứng từ mới (ảnh / PDF / XML) qua Telegram mỗi lần sao lưu. */
  backup_telegram_documents: z.boolean(),
});
export type Settings = z.infer<typeof settingsSchema>;

export const branchSchema = z.object({
  name: z.string().trim().min(1, 'Nhập tên quán'),
  address: z.string().trim().max(200),
  phone: z.string().trim().max(20),
});

const view = z.object({ branch: branchSchema, settings: settingsSchema });

export const settingsContract = c.router(
  {
    get: { method: 'GET', path: '/api/settings', responses: { 200: view, ...commonErrors } },
    update: {
      method: 'PUT',
      path: '/api/settings',
      body: z.object({ branch: branchSchema.optional(), settings: settingsSchema.partial().optional() }),
      responses: { 200: view, ...commonErrors },
      metadata: { roles: ['ADMIN'] } satisfies RouteMeta,
    },
  },
  { strictStatusCodes: true },
);
