import { describe, expect, it } from 'vitest';
import { allocateVnd, roundUpTo, roundVnd, sum } from './money';

const nums = (xs: { toNumber(): number }[]) => xs.map((x) => x.toNumber());

describe('roundVnd', () => {
  it('rounds half away from zero to whole đồng', () => {
    expect(roundVnd('1250.5').toNumber()).toBe(1251);
    expect(roundVnd('1250.49').toNumber()).toBe(1250);
    expect(roundVnd('-10.5').toNumber()).toBe(-11);
  });
});

describe('roundUpTo', () => {
  it('rounds a suggested price up to the step', () => {
    expect(roundUpTo('85714.28', 1000).toNumber()).toBe(86000);
    expect(roundUpTo('80000', 1000).toNumber()).toBe(80000);
    expect(roundUpTo('113846', 5000).toNumber()).toBe(115000);
  });
});

describe('allocateVnd', () => {
  it('splits proportionally and the shares add up exactly', () => {
    const shares = allocateVnd(24000, [120000, 50000, 20000, 30000, 20000]);
    expect(nums(shares)).toEqual([12000, 5000, 2000, 3000, 2000]);
    expect(sum(shares).toNumber()).toBe(24000);
  });

  it('gives leftover đồng to the largest remainders', () => {
    const shares = allocateVnd(100, [1, 1, 1]);
    expect(nums(shares)).toEqual([34, 33, 33]);
  });

  it('handles all-zero weights and empty input', () => {
    expect(nums(allocateVnd(500, [0, 0]))).toEqual([500, 0]);
    expect(allocateVnd(500, [])).toEqual([]);
  });
});
