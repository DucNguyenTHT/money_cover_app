// Texts of the Telegram messages sent to the owner. Telegram "HTML" parse mode: only <b> is used and every
// value typed by a person (names, reasons, notes) is escaped.
import { D, roundVnd, type Num } from '../money';

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 1250000 → "1.250.000 đ"; negatives with a true minus sign. */
export function vnd(v: Num): string {
  const n = roundVnd(v);
  const digits = n
    .abs()
    .toFixed(0)
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${n.isNegative() && !n.isZero() ? '−' : ''}${digits} đ`;
}

/** "2026-10-23" → "23/10/2026" (or "23/10" without the year). */
export const dmy = (iso: string, withYear = true) => {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return withYear ? `${d}/${m}/${y}` : `${d}/${m}`;
};

/** Shop time (UTC+7) "HH:mm" of an instant. */
export const hhmm = (at: Date | string) =>
  new Date(new Date(at).getTime() + 7 * 3600_000).toISOString().slice(11, 16);

const pct = (part: Num, whole: Num) => {
  const w = D(whole);
  if (w.isZero()) return null;
  return D(part).div(w).mul(100).toDecimalPlaces(0).toNumber();
};

export const METHOD_NAMES: Record<string, string> = {
  CASH: 'Tiền mặt',
  TRANSFER: 'Chuyển khoản',
  CARD: 'Thẻ',
  APP: 'App',
};

export interface DailyReportData {
  shop: string;
  date: string;
  /** Second closing of the same day (after a change). */
  reclose: boolean;
  orders: number;
  guests: number;
  netRevenue: Num;
  /** null when the cost is not known yet (nothing sold). */
  grossProfit: Num | null;
  /** Net revenue of the business day before, null when it had no sales. */
  prevNetRevenue: Num | null;
  byMethod: Record<string, Num>;
  expectedCash: Num;
  countedCash: Num;
  cashDiff: Num;
  /** |cash difference| from which the line is flagged. */
  cashDiffWarn: Num;
  discounts: Num;
  cancelled: number;
  belowCost: number;
  closedBy: string;
  closedAt: Date | string;
  note: string | null;
  /** More lines from other features (transfers not received, e-invoices…), already formatted. */
  extra?: string[];
}

export function dailyReportText(d: DailyReportData): string {
  const lines = [
    `<b>📊 ${d.reclose ? 'Chốt lại ngày' : 'Chốt ngày'} ${dmy(d.date)}</b> · ${escapeHtml(d.shop)}`,
    `Doanh thu thuần: <b>${vnd(d.netRevenue)}</b> · ${d.orders} đơn · ${d.guests} khách`,
  ];
  if (d.prevNetRevenue !== null && !D(d.prevNetRevenue).isZero()) {
    const change = D(d.netRevenue).sub(d.prevNetRevenue).div(d.prevNetRevenue).mul(100).toDecimalPlaces(0);
    lines.push(
      `So với hôm trước: ${change.isNegative() ? '−' : '+'}${change.abs().toString()}% (${vnd(d.prevNetRevenue)})`,
    );
  }
  if (d.grossProfit !== null && d.orders > 0) {
    const p = pct(d.grossProfit, d.netRevenue);
    const loss = D(d.grossProfit).isNegative();
    lines.push(
      `${loss ? 'Lỗ gộp' : 'Lãi gộp'} tạm tính: ${vnd(d.grossProfit)}${p !== null ? ` (${p}% doanh thu)` : ''}`,
    );
  }
  const methods = Object.entries(d.byMethod).filter(([, v]) => !D(v).isZero());
  if (methods.length)
    lines.push(`Đã thu: ${methods.map(([m, v]) => `${METHOD_NAMES[m] ?? m} ${vnd(v)}`).join(' · ')}`);
  const diff = D(d.cashDiff);
  const flagged = diff.abs().gte(D(d.cashDiffWarn)) && !diff.isZero();
  lines.push(
    `Tiền mặt két: dự kiến ${vnd(d.expectedCash)} · đếm ${vnd(d.countedCash)} · ${
      diff.isZero()
        ? 'khớp'
        : `${flagged ? '<b>' : ''}${diff.isNegative() ? 'thiếu' : 'thừa'} ${vnd(diff.abs())}${flagged ? '</b> ⚠️' : ''}`
    }`,
  );
  const control = [
    !D(d.discounts).isZero() ? `Giảm giá ${vnd(d.discounts)}` : null,
    d.cancelled ? `Huỷ ${d.cancelled} đơn` : null,
    d.belowCost ? `Bán dưới giá vốn ${d.belowCost} đơn ⚠️` : null,
  ].filter(Boolean);
  if (control.length) lines.push(control.join(' · '));
  for (const e of d.extra ?? []) lines.push(e);
  if (d.note?.trim()) lines.push(`Ghi chú: ${escapeHtml(d.note.trim())}`);
  lines.push(`Người chốt: ${escapeHtml(d.closedBy)} lúc ${hhmm(d.closedAt)}`);
  return lines.join('\n');
}

export interface MorningData {
  /** Calendar date of the message. */
  date: string;
  /** The last business day before today: its sales and whether it was closed. */
  yesterday: { date: string; netRevenue: Num; orders: number; closed: boolean } | null;
  lowStock: string[];
  pendingIngredients: number;
  lossDishes: number;
  overTargetDishes: number;
  optionAlerts: number;
  staleOpenOrders: number;
  /** Days of the month with sales but no closing (yesterday excluded, it has its own line). */
  unclosedDays: number;
  backup: string | null;
  tax: { revenueYtd: Num; threshold: Num; einvoiceRegistered: boolean } | null;
  /** More lines from other features, already formatted. */
  extra?: string[];
}

const list = (names: string[], max = 6) =>
  names.length > max
    ? `${names.slice(0, max).map(escapeHtml).join(', ')} và ${names.length - max} thứ khác`
    : names.map(escapeHtml).join(', ');

/** "1,05 tỷ" / "850 triệu" for a yearly revenue. */
const big = (v: Num) => {
  const n = D(v);
  if (n.abs().gte(1e9)) return `${n.div(1e9).toDecimalPlaces(2).toString().replace('.', ',')} tỷ`;
  return `${n.div(1e6).toDecimalPlaces(0).toString()} triệu`;
};

export function morningText(m: MorningData): string {
  const lines = [`<b>☀️ Việc cần chú ý · ${dmy(m.date)}</b>`];
  const y = m.yesterday;
  if (y) {
    lines.push(`Hôm qua (${dmy(y.date, false)}): doanh thu thuần ${vnd(y.netRevenue)} · ${y.orders} đơn`);
  }
  const items: string[] = [];
  if (y && !y.closed && y.orders > 0)
    items.push(`⚠️ Ngày ${dmy(y.date, false)} chưa chốt ngày (đếm tiền két)`);
  if (m.unclosedDays > 0) items.push(`${m.unclosedDays} ngày khác trong tháng chưa chốt`);
  if (m.staleOpenOrders > 0) items.push(`${m.staleOpenOrders} đơn còn mở từ hôm trước — thanh toán hoặc huỷ`);
  if (m.lowStock.length) items.push(`Sắp hết hàng (${m.lowStock.length}): ${list(m.lowStock)}`);
  if (m.pendingIngredients > 0)
    items.push(`Nợ kho ${m.pendingIngredients} nguyên liệu — nhập phiếu nhập để có giá vốn đúng`);
  const price = [
    m.lossDishes ? `${m.lossDishes} món đang lỗ` : null,
    m.overTargetDishes ? `${m.overTargetDishes} món vượt % nguyên liệu mục tiêu` : null,
    m.optionAlerts ? `${m.optionAlerts} tuỳ chọn có lãi thấp` : null,
  ].filter(Boolean);
  if (price.length) items.push(`Giá bán: ${price.join(', ')}`);
  if (m.backup) items.push(`Sao lưu: ${escapeHtml(m.backup)}`);
  if (m.tax) {
    const over = D(m.tax.revenueYtd).gt(m.tax.threshold);
    if (over && !m.tax.einvoiceRegistered)
      items.push(
        `⚠️ Doanh thu năm ${big(m.tax.revenueYtd)} đã vượt ngưỡng ${big(m.tax.threshold)}: phải dùng hoá đơn điện tử từ máy tính tiền`,
      );
    else if (!over && D(m.tax.revenueYtd).gte(D(m.tax.threshold).mul(0.8)))
      items.push(`Doanh thu năm ${big(m.tax.revenueYtd)}, sắp tới ngưỡng ${big(m.tax.threshold)}`);
  }
  for (const e of m.extra ?? []) items.push(e);
  if (items.length) lines.push(...items.map((i) => `• ${i}`));
  else lines.push('✅ Không có việc gì cần chú ý.');
  return lines.join('\n');
}

// ---------------------------------------------------------------- instant alerts

export function cancelPaidAlert(a: {
  code: string;
  date: string;
  total: Num;
  reason: string;
  by: string;
  approvedBy: string | null;
}): string {
  return [
    `⚠️ <b>Huỷ đơn đã thanh toán</b> ${a.code} · ${vnd(a.total)}`,
    `Ngày bán ${dmy(a.date)} · Người huỷ: ${escapeHtml(a.by)}${a.approvedBy ? ` · Duyệt PIN: ${escapeHtml(a.approvedBy)}` : ''}`,
    `Lý do: ${escapeHtml(a.reason)}`,
  ].join('\n');
}

export function discountAlert(a: {
  code: string;
  pct: Num;
  amount: Num;
  reason: string | null;
  by: string;
  approvedBy: string;
}): string {
  const p = D(a.pct).toDecimalPlaces(1).toString().replace('.', ',');
  return [
    `⚠️ <b>Giảm giá vượt mức</b> đơn ${a.code}: ${p}% (${vnd(a.amount)})`,
    `Thu ngân: ${escapeHtml(a.by)} · Duyệt: ${escapeHtml(a.approvedBy)}`,
    ...(a.reason ? [`Lý do: ${escapeHtml(a.reason)}`] : []),
  ].join('\n');
}

export function belowCostAlert(a: {
  code: string;
  netRevenue: Num;
  cost: Num;
  reason: string | null;
  by: string;
}): string {
  return [
    `⚠️ <b>Bán dưới giá vốn</b> đơn ${a.code}: thu ${vnd(a.netRevenue)}, giá vốn ${vnd(a.cost)} (lỗ ${vnd(D(a.cost).sub(a.netRevenue))})`,
    `Thu ngân: ${escapeHtml(a.by)}${a.reason ? ` · Lý do: ${escapeHtml(a.reason)}` : ''}`,
  ].join('\n');
}
