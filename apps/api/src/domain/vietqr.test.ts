import { describe, expect, it } from 'vitest';
import { asciiPurpose, crc16, vietQrPayload } from './vietqr';

describe('vietqr', () => {
  it('CRC-16/CCITT-FALSE check value', () => expect(crc16('123456789')).toBe('29B1'));

  it('builds a dynamic payload with amount, purpose and a valid CRC', () => {
    const s = vietQrPayload({
      bin: '970436',
      accountNo: '0011001234567',
      amount: 216000,
      purpose: 'Đơn 261012-007',
    });
    expect(s.startsWith('000201010212')).toBe(true);
    expect(s).toContain('0010A000000727');
    expect(s).toContain('0006970436');
    expect(s).toContain('5406216000');
    expect(s).toContain('5303704');
    expect(s).toContain('5802VN');
    expect(s).toContain('Don 261012-007');
    expect(crc16(s.slice(0, -4))).toBe(s.slice(-4));
  });

  it('strips Vietnamese marks from the purpose', () =>
    expect(asciiPurpose('Thanh toán đơn #12')).toBe('Thanh toan don 12'));
});
