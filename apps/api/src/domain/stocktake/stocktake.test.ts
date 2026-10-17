import { describe, expect, it } from 'vitest';
import { allocateLoss, variance } from './stocktake';

const n = (d: { toNumber(): number }) => d.toNumber();

describe('stocktake', () => {
  it('variance sign', () => {
    expect(n(variance(10, 9).shortage)).toBe(1);
    expect(n(variance(10, 12).surplus)).toBe(2);
  });

  it('plan example: 1 kg beef short (120.000), phở and bún used 2 kg each → 60.000 each', () => {
    const r = allocateLoss(120000, [
      { dishId: 1, qty: 2 },
      { dishId: 2, qty: 2 },
    ]);
    expect(r.map((x) => [x.dishId, n(x.value)])).toEqual([
      [1, 60000],
      [2, 60000],
    ]);
  });

  it('no dish used it → general loss', () => {
    expect(allocateLoss(5000, [])).toEqual([expect.objectContaining({ dishId: null })]);
  });

  it('surplus is allocated as a negative value and still sums exactly', () => {
    const r = allocateLoss(-1001, [
      { dishId: 1, qty: 1 },
      { dishId: 2, qty: 2 },
    ]);
    expect(r.reduce((s, x) => s + n(x.value), 0)).toBe(-1001);
  });
});
