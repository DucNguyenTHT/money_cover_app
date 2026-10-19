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
  /**
   * Options chosen for the line (domain/menu/options.ts): `factor` multiplies the recipe's ingredient lines (size;
   * packaging stays one per portion), `extras` are added per portion (extra egg…).
   */
  factor?: Num;
  extras?: readonly { ingredientId: number; qty: Num }[];
}

/** Total ingredient usage (stock units) for a set of sold dishes. */
export function consumption(sold: readonly SoldLine[]): Map<number, Decimal> {
  const out = new Map<number, Decimal>();
  const add = (id: number, q: Decimal) => out.set(id, (out.get(id) ?? ZERO).add(q));
  for (const s of sold) {
    for (const r of s.recipe) {
      if (!scopeApplies(r.scope, s.channel)) continue;
      add(
        r.ingredientId,
        D(r.qty)
          .mul(r.scope === 'ALL' ? (s.factor ?? 1) : 1)
          .mul(s.qty),
      );
    }
    for (const e of s.extras ?? []) add(e.ingredientId, D(e.qty).mul(s.qty));
  }
  return out;
}

/** Recipe quantities are typed in recipe units (g); stored in stock units (kg). */
export const recipeToStock = (qtyRecipeUnit: Num, recipeFactor: Num): Decimal =>
  D(qtyRecipeUnit).div(recipeFactor);
export const stockToRecipe = (qtyStock: Num, recipeFactor: Num): Decimal => D(qtyStock).mul(recipeFactor);
