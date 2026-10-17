import { D, Decimal, ZERO, allocateVnd, type Num } from '../money';

/**
 * Split a sales issue's cost back onto the order lines that caused it.
 * For each ingredient, its issued cost is shared by the lines in proportion to how much of it each used,
 * so the line costs always add up exactly to the issue cost.
 */
export function itemCosts(
  usageByLine: readonly Map<number, Decimal>[],
  costByIngredient: ReadonlyMap<number, Num>,
): Decimal[] {
  const out = usageByLine.map(() => ZERO);
  for (const [ingredientId, cost] of costByIngredient) {
    const weights = usageByLine.map((u) => u.get(ingredientId) ?? ZERO);
    if (weights.every((w) => w.isZero())) continue;
    allocateVnd(D(cost), weights).forEach((share, i) => (out[i] = out[i]!.add(share)));
  }
  return out;
}
