import { describe, expect, it } from 'vitest';
import {
  codeInDescription,
  compactText,
  orderByAmount,
  parseShopTime,
  transferCheck,
  transferSummary,
} from './match';

describe('compactText', () => {
  it('keeps letters and digits, drops marks and case', () => {
    expect(compactText('Ck đơn 261023-015 Phở')).toBe('CKDON261023015PHO');
    expect(compactText('MBVCB.1234567.261023-015.CT tu 0123')).toBe('MBVCB1234567261023015CTTU0123');
  });
});

describe('codeInDescription', () => {
  const codes = ['261023-015', '261023-016', '261023-100', '261023-1000', '261022-015'];

  it('finds the order code whatever the bank did to the content', () => {
    expect(codeInDescription('261023-015', codes)).toBe('261023-015');
    expect(codeInDescription('MBVCB.8876.261023015.CT tu 0901234567 NGUYEN VAN A', codes)).toBe('261023-015');
    expect(codeInDescription('IBFT 261023 016 thanh toan', codes)).toBe('261023-016');
    expect(codeInDescription('chuyen tien an pho', codes)).toBeNull();
  });

  it('prefers the longest code (order 1000 is not order 100)', () => {
    expect(codeInDescription('TT 261023-1000', codes)).toBe('261023-1000');
    expect(codeInDescription('TT 261023-100 xin cam on', codes)).toBe('261023-100');
  });

  it('the date is part of the code', () => {
    expect(codeInDescription('261022-015', codes)).toBe('261022-015');
  });
});

describe('orderByAmount', () => {
  it('only when exactly one till waits for that amount', () => {
    expect(orderByAmount('226800', [{ orderId: 7, amount: '226800' }])).toBe(7);
    expect(
      orderByAmount('226800', [
        { orderId: 7, amount: '226800' },
        { orderId: 9, amount: '50000' },
      ]),
    ).toBe(7);
    expect(
      orderByAmount('50000', [
        { orderId: 7, amount: '50000' },
        { orderId: 9, amount: '50000' },
      ]),
    ).toBeNull();
    expect(orderByAmount('49000', [{ orderId: 7, amount: '50000' }])).toBeNull();
  });
});

describe('transferCheck / transferSummary', () => {
  it('compares what the till recorded with what the bank shows', () => {
    expect(transferCheck('100000', '100000')).toBe('OK');
    expect(transferCheck('100000', '0')).toBe('SHORT');
    expect(transferCheck('0', '50000')).toBe('OVER');
    const s = transferSummary([
      { expected: '100000', received: '100000' },
      { expected: '50000', received: '0' },
      { expected: '0', received: '20000' },
    ]);
    expect(s.expected.toString()).toBe('150000');
    expect(s.received.toString()).toBe('120000');
    expect(s.short).toBe(1);
  });
});

describe('parseShopTime', () => {
  it('reads bank feed times as Vietnam time', () => {
    expect(parseShopTime('2025-08-15 09:30:00').toISOString()).toBe('2025-08-15T02:30:00.000Z');
    expect(parseShopTime('2021-04-15T00:00:00').toISOString()).toBe('2021-04-14T17:00:00.000Z');
    expect(parseShopTime('2021-04-15 23:05').toISOString()).toBe('2021-04-15T16:05:00.000Z');
    expect(Number.isNaN(parseShopTime('hôm qua').getTime())).toBe(true);
  });
});
