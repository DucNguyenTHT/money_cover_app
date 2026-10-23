import { describe, expect, it } from 'vitest';
import { clockToInstant, instantToClock, monthPay, shiftHours, workedHours } from './payroll';

describe('staff time and pay', () => {
  it('shift length, also past midnight', () => {
    expect(shiftHours('06:00', '14:00')).toBe(8);
    expect(shiftHours('22:00', '02:00')).toBe(4);
    expect(shiftHours('07:30', '07:30')).toBe(24);
    expect(shiftHours('7h', '14:00')).toBe(0);
  });

  it('clock times on a business day; early-morning times belong to the next calendar day', () => {
    const inAt = clockToInstant('2026-10-05', '18:00', '04:00');
    expect(inAt.toISOString()).toBe('2026-10-05T11:00:00.000Z');
    const outAt = clockToInstant('2026-10-05', '01:30', '04:00');
    expect(outAt.toISOString()).toBe('2026-10-05T18:30:00.000Z');
    expect(instantToClock(outAt)).toBe('01:30');
    expect(workedHours(inAt, outAt).toNumber()).toBe(7.5);
    expect(workedHours(inAt, null).toNumber()).toBe(0);
    expect(workedHours(outAt, inAt).toNumber()).toBe(0);
  });

  it('hourly and monthly pay, bonus, deduction and advances', () => {
    const hourly = monthPay({
      payType: 'HOURLY',
      rate: 25000,
      hours: '101.5',
      bonus: 200000,
      deduction: 50000,
      advance: 1000000,
    });
    expect([hourly.basePay, hourly.gross, hourly.toPay].map((d) => d.toNumber())).toEqual([
      2_537_500, 2_687_500, 1_687_500,
    ]);
    const monthly = monthPay({
      payType: 'MONTHLY',
      rate: 7000000,
      hours: 0,
      bonus: 0,
      deduction: 0,
      advance: 0,
    });
    expect(monthly.toPay.toNumber()).toBe(7_000_000);
  });
});
