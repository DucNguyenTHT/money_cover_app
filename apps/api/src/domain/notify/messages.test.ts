import { describe, expect, it } from 'vitest';
import {
  belowCostAlert,
  cancelPaidAlert,
  dailyReportText,
  discountAlert,
  escapeHtml,
  morningText,
  vnd,
  type DailyReportData,
  type MorningData,
} from './messages';

describe('vnd', () => {
  it('groups thousands, rounds to đồng and uses a true minus', () => {
    expect(vnd('1250000')).toBe('1.250.000 đ');
    expect(vnd(999)).toBe('999 đ');
    expect(vnd('-50000.4')).toBe('−50.000 đ');
    expect(vnd(0)).toBe('0 đ');
  });
});

describe('escapeHtml', () => {
  it('neutralises what people type', () => {
    expect(escapeHtml('<b>Tèo & Tí</b>')).toBe('&lt;b&gt;Tèo &amp; Tí&lt;/b&gt;');
  });
});

const day: DailyReportData = {
  shop: 'Phở Hà Nội',
  date: '2026-10-23',
  reclose: false,
  orders: 125,
  guests: 210,
  netRevenue: '12345000',
  grossProfit: '6100000',
  prevNetRevenue: '11430000',
  byMethod: { CASH: '5200000', TRANSFER: '4000000', CARD: '0', APP: '3145000' },
  expectedCash: '5200000',
  countedCash: '5150000',
  cashDiff: '-50000',
  cashDiffWarn: 20000,
  discounts: '120000',
  cancelled: 2,
  belowCost: 1,
  closedBy: 'Lan',
  closedAt: '2026-10-23T15:41:00.000Z',
  note: null,
};

describe('daily report', () => {
  it('sums up the day for the owner', () => {
    expect(dailyReportText(day)).toBe(
      [
        '<b>📊 Chốt ngày 23/10/2026</b> · Phở Hà Nội',
        'Doanh thu thuần: <b>12.345.000 đ</b> · 125 đơn · 210 khách',
        'So với hôm trước: +8% (11.430.000 đ)',
        'Lãi gộp tạm tính: 6.100.000 đ (49% doanh thu)',
        'Đã thu: Tiền mặt 5.200.000 đ · Chuyển khoản 4.000.000 đ · App 3.145.000 đ',
        'Tiền mặt két: dự kiến 5.200.000 đ · đếm 5.150.000 đ · <b>thiếu 50.000 đ</b> ⚠️',
        'Giảm giá 120.000 đ · Huỷ 2 đơn · Bán dưới giá vốn 1 đơn ⚠️',
        'Người chốt: Lan lúc 22:41',
      ].join('\n'),
    );
  });

  it('a small cash difference is not flagged; a loss says so; notes are escaped', () => {
    const t = dailyReportText({
      ...day,
      reclose: true,
      cashDiff: '5000',
      countedCash: '5205000',
      grossProfit: '-300000',
      prevNetRevenue: null,
      discounts: 0,
      cancelled: 0,
      belowCost: 0,
      note: 'Két <thiếu> 5k',
      extra: ['Chuyển khoản chưa thấy tiền về: 1 đơn'],
    });
    expect(t).toContain('Chốt lại ngày 23/10/2026');
    expect(t).toContain('· thừa 5.000 đ\n');
    expect(t).toContain('Lỗ gộp tạm tính: −300.000 đ');
    expect(t).not.toContain('So với hôm trước');
    expect(t).not.toContain('Huỷ');
    expect(t).toContain('Chuyển khoản chưa thấy tiền về: 1 đơn');
    expect(t).toContain('Ghi chú: Két &lt;thiếu&gt; 5k');
  });
});

const quiet: MorningData = {
  date: '2026-10-24',
  yesterday: { date: '2026-10-23', netRevenue: '12345000', orders: 125, closed: true },
  lowStock: [],
  pendingIngredients: 0,
  lossDishes: 0,
  overTargetDishes: 0,
  optionAlerts: 0,
  staleOpenOrders: 0,
  unclosedDays: 0,
  backup: null,
  tax: { revenueYtd: '500000000', threshold: '1000000000', einvoiceRegistered: false },
};

describe('morning digest', () => {
  it('nothing to do', () => {
    expect(morningText(quiet)).toBe(
      [
        '<b>☀️ Việc cần chú ý · 24/10/2026</b>',
        'Hôm qua (23/10): doanh thu thuần 12.345.000 đ · 125 đơn',
        '✅ Không có việc gì cần chú ý.',
      ].join('\n'),
    );
  });

  it('lists what needs doing', () => {
    const t = morningText({
      ...quiet,
      yesterday: { date: '2026-10-23', netRevenue: '12345000', orders: 125, closed: false },
      lowStock: ['Thịt bò', 'Bánh phở', 'Hành', 'Ngò', 'Chanh', 'Ớt', 'Tỏi', 'Gừng'],
      pendingIngredients: 2,
      lossDishes: 1,
      overTargetDishes: 3,
      staleOpenOrders: 1,
      backup: 'lần gần nhất bị lỗi',
      tax: { revenueYtd: '1050000000', threshold: '1000000000', einvoiceRegistered: false },
    });
    expect(t.split('\n').slice(2)).toEqual([
      '• ⚠️ Ngày 23/10 chưa chốt ngày (đếm tiền két)',
      '• 1 đơn còn mở từ hôm trước — thanh toán hoặc huỷ',
      '• Sắp hết hàng (8): Thịt bò, Bánh phở, Hành, Ngò, Chanh, Ớt và 2 thứ khác',
      '• Nợ kho 2 nguyên liệu — nhập phiếu nhập để có giá vốn đúng',
      '• Giá bán: 1 món đang lỗ, 3 món vượt % nguyên liệu mục tiêu',
      '• Sao lưu: lần gần nhất bị lỗi',
      '• ⚠️ Doanh thu năm 1,05 tỷ đã vượt ngưỡng 1 tỷ: phải dùng hoá đơn điện tử từ máy tính tiền',
    ]);
  });

  it('warns when the year revenue nears the threshold', () => {
    const t = morningText({ ...quiet, yesterday: null, tax: { ...quiet.tax!, revenueYtd: '850000000' } });
    expect(t).toBe(
      ['<b>☀️ Việc cần chú ý · 24/10/2026</b>', '• Doanh thu năm 850 triệu, sắp tới ngưỡng 1 tỷ'].join('\n'),
    );
  });
});

describe('alerts', () => {
  it('cancel of a paid order', () => {
    expect(
      cancelPaidAlert({
        code: '261023-015',
        date: '2026-10-23',
        total: '350000',
        reason: 'Khách đổi ý',
        by: 'Lan',
        approvedBy: 'Chủ',
      }),
    ).toBe(
      [
        '⚠️ <b>Huỷ đơn đã thanh toán</b> 261023-015 · 350.000 đ',
        'Ngày bán 23/10/2026 · Người huỷ: Lan · Duyệt PIN: Chủ',
        'Lý do: Khách đổi ý',
      ].join('\n'),
    );
  });

  it('discount over the limit and sale below cost', () => {
    expect(
      discountAlert({
        code: '261023-020',
        pct: '25',
        amount: '150000',
        reason: 'Khách quen',
        by: 'Lan',
        approvedBy: 'Chủ',
      }),
    ).toBe(
      [
        '⚠️ <b>Giảm giá vượt mức</b> đơn 261023-020: 25% (150.000 đ)',
        'Thu ngân: Lan · Duyệt: Chủ',
        'Lý do: Khách quen',
      ].join('\n'),
    );
    expect(
      belowCostAlert({
        code: '261023-021',
        netRevenue: '50000',
        cost: '62000',
        reason: 'Khai trương',
        by: 'Lan',
      }),
    ).toBe(
      [
        '⚠️ <b>Bán dưới giá vốn</b> đơn 261023-021: thu 50.000 đ, giá vốn 62.000 đ (lỗ 12.000 đ)',
        'Thu ngân: Lan · Lý do: Khai trương',
      ].join('\n'),
    );
  });
});
