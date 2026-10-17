import { describe, expect, it } from 'vitest';
import { businessDateOf, parseDayStart } from './business-date';

describe('businessDateOf', () => {
  it('uses Vietnam local time', () => {
    // 2026-10-11 18:30 UTC = 2026-10-12 01:30 in Vietnam
    expect(businessDateOf(new Date('2026-10-11T18:30:00Z'), '00:00')).toBe('2026-10-12');
  });

  it('counts sales before business_day_start as the previous day', () => {
    // 01:30 on the 12th (VN) with the day starting at 04:00 belongs to the 11th
    expect(businessDateOf(new Date('2026-10-11T18:30:00Z'), '04:00')).toBe('2026-10-11');
    // 04:00 sharp starts the 12th
    expect(businessDateOf(new Date('2026-10-11T21:00:00Z'), '04:00')).toBe('2026-10-12');
  });

  it('rejects malformed day-start values', () => {
    expect(() => parseDayStart('25:00')).toThrow();
    expect(() => parseDayStart('4h')).toThrow();
  });
});
