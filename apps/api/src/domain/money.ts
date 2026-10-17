import Decimal from 'decimal.js';

export { Decimal };
export type Num = Decimal.Value;

export const D = (v: Num): Decimal => new Decimal(v);
export const ZERO = new Decimal(0);

/** Round to whole đồng, half away from zero. */
export const roundVnd = (v: Num): Decimal => D(v).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);

/** Round a price up to the next multiple of `step` (e.g. 1000). */
export const roundUpTo = (v: Num, step: Num): Decimal => {
  const s = D(step);
  if (s.lte(0)) return D(v);
  return D(v).div(s).toDecimalPlaces(0, Decimal.ROUND_CEIL).mul(s);
};

export const sum = (values: readonly Num[]): Decimal => values.reduce<Decimal>((acc, v) => acc.add(v), ZERO);

/**
 * Split `total` (whole đồng) across `weights` proportionally.
 * Shares are integers that add up exactly to `total`; leftover đồng go to the largest remainders.
 */
export function allocateVnd(total: Num, weights: readonly Num[]): Decimal[] {
  const t = roundVnd(total);
  const w = weights.map((x) => D(x));
  const wSum = sum(w);
  if (w.length === 0) return [];
  if (wSum.isZero()) return w.map((_, i) => (i === 0 ? t : ZERO));

  const raw = w.map((x) => t.mul(x).div(wSum));
  const floors = raw.map((x) => x.toDecimalPlaces(0, Decimal.ROUND_DOWN));
  let left = t.sub(sum(floors)).toNumber();
  const order = raw
    .map((x, i) => ({ i, frac: x.sub(floors[i]!) }))
    .sort((a, b) => b.frac.cmp(a.frac) || a.i - b.i);
  const step = left >= 0 ? 1 : -1;
  for (let k = 0; left !== 0; k = (k + 1) % order.length) {
    const idx = order[k]!.i;
    floors[idx] = floors[idx]!.add(step);
    left -= step;
  }
  return floors;
}
