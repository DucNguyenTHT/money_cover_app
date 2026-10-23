const vnd = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const qtyFmt = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 });

/** 1250000 → "1.250.000"; negatives use a true minus sign. */
export function money(v: number | string | null | undefined): string {
  const n = Number(v ?? 0);
  const s = vnd.format(Math.abs(n));
  return n < 0 ? `−${s}` : s;
}

export const moneyVnd = (v: number | string | null | undefined) => `${money(v)} ₫`;

export const qty = (v: number | string) => qtyFmt.format(Number(v));

/** Units counted in whole pieces: their stock shows at most one decimal ("12 cái", not "11,998 cái"). */
const COUNT_UNITS = new Set([
  'cái',
  'chiếc',
  'chai',
  'lon',
  'hộp',
  'quả',
  'trái',
  'gói',
  'bó',
  'túi',
  'bịch',
  'cuộn',
  'ly',
  'cốc',
  'con',
  'miếng',
  'thùng',
  'két',
  'bao',
  'vỉ',
  'cây',
  'tờ',
  'phần',
]);
const pieceFmt = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });

/** Quantity followed by its unit, rounded to suit the unit. */
export const qtyUnit = (v: number | string, unit: string) =>
  `${(COUNT_UNITS.has(unit.trim().toLowerCase()) ? pieceFmt : qtyFmt).format(Number(v))} ${unit}`;

/** Quantity typed by a user: "1,5" and "1.5" both mean 1.5 (no thousands separators in quantities). */
export function parseQty(v: string): number {
  const s = v.trim().replace(/\s/g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Money typed by a user: separators are ignored, "264.000" → 264000. */
export function parseMoney(v: string): number {
  const digits = v.replace(/[^\d-]/g, '');
  const n = Number(digits);
  return digits === '' || !Number.isFinite(n) ? NaN : n;
}

/** "2026-10-12" → "12/10/2026" */
export const dateVi = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};
