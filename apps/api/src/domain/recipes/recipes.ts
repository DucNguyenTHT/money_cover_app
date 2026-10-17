import type { Channel, RecipeScope } from '../enums';
import { D, Decimal, ZERO, type Num } from '../money';

/** The recipe version in force on `date` (latest effectiveFrom ≤ date), or undefined. */
export function pickVersion<T extends { effectiveFrom: string }>(
  versions: readonly T[],
  date: string,
): T | undefined {
  let best: T | undefined;
  for (const v of versions) {
    if (v.effectiveFrom <= date && (!best || v.effectiveFrom > best.effectiveFrom)) best = v;
  }
  return best;
}

/** Packaging lines (scope TAKEAWAY_APP) apply only to takeaway and app orders. */
export const scopeApplies = (scope: RecipeScope, channel: Channel) =>
  scope === 'ALL' || channel !== 'DINE_IN';

export interface RecipeLine {
  ingredientId: number;
  /** Quantity per portion, in the ingredient's stock unit. */
  qty: Num;
  scope: RecipeScope;
}

export interface SoldLine {
  qty: Num;
  channel: Channel;
  recipe: readonly RecipeLine[];
}

/** Total ingredient usage (stock units) for a set of sold dishes. */
export function consumption(sold: readonly SoldLine[]): Map<number, Decimal> {
  const out = new Map<number, Decimal>();
  for (const s of sold) {
    for (const r of s.recipe) {
      if (!scopeApplies(r.scope, s.channel)) continue;
      out.set(r.ingredientId, (out.get(r.ingredientId) ?? ZERO).add(D(r.qty).mul(s.qty)));
    }
  }
  return out;
}

/** Recipe quantities are typed in recipe units (g); stored in stock units (kg). */
export const recipeToStock = (qtyRecipeUnit: Num, recipeFactor: Num): Decimal =>
  D(qtyRecipeUnit).div(recipeFactor);
export const stockToRecipe = (qtyStock: Num, recipeFactor: Num): Decimal => D(qtyStock).mul(recipeFactor);
