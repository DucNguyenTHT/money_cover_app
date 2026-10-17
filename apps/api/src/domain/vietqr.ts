// VietQR (NAPAS 247) payload following EMVCo Merchant-Presented QR. Built offline; any bank app can scan it.

const field = (id: string, value: string) => `${id}${String(value.length).padStart(2, '0')}${value}`;

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) as 4 upper-case hex digits. */
export function crc16(s: string): string {
  let crc = 0xffff;
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Bank apps reject non-ASCII in the purpose field: drop diacritics and odd characters. */
export const asciiPurpose = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9 \-.]/g, '')
    .slice(0, 50);

export interface VietQrInput {
  /** Bank BIN (6 digits, e.g. 970436 for Vietcombank). */
  bin: string;
  accountNo: string;
  /** Whole đồng; omitted = customer types the amount. */
  amount?: number;
  purpose?: string;
}

export function vietQrPayload(q: VietQrInput): string {
  const beneficiary = field('00', q.bin) + field('01', q.accountNo);
  const merchant = field('00', 'A000000727') + field('01', beneficiary) + field('02', 'QRIBFTTA');
  let s =
    field('00', '01') + field('01', q.amount ? '12' : '11') + field('38', merchant) + field('53', '704');
  if (q.amount) s += field('54', String(Math.round(q.amount)));
  s += field('58', 'VN');
  const purpose = q.purpose ? asciiPurpose(q.purpose) : '';
  if (purpose) s += field('62', field('08', purpose));
  s += '6304';
  return s + crc16(s);
}

export const vietQrConfigured = (bin: string, accountNo: string) =>
  /^\d{6}$/.test(bin) && /^\d{4,19}$/.test(accountNo);
