// Semi-finished goods (bán thành phẩm: broth, sauces): cooked in batches from ingredients, then used by dishes like
// any ingredient. A production takes its inputs out of stock (FIFO) and puts the output in as a new lot whose unit
// cost = what the inputs cost ÷ the quantity actually obtained.
import { D, Decimal, ZERO, type Num } from '../money';

export interface SemiRecipeLine {
  ingredientId: number;
  /** Quantity for one batch, in the input's stock unit. */
  qty: Num;
}

/** Inputs for `output` of the semi-finished good when one batch of the recipe yields `yieldQty`. */
export function scaleRecipe(
  lines: readonly SemiRecipeLine[],
  yieldQty: Num,
  output: Num,
): { ingredientId: number; qty: Decimal }[] {
  const y = D(yieldQty);
  if (y.lte(0)) throw new Error('Sản lượng một mẻ phải lớn hơn 0');
  const f = D(output).div(y);
  return lines.map((l) => ({ ingredientId: l.ingredientId, qty: D(l.qty).mul(f).toDecimalPlaces(4) }));
}

/** Unit cost of the produced lot (4 decimals, like purchase lots). */
export function productionUnitCost(inputCost: Num, output: Num): Decimal {
  const q = D(output);
  if (q.lte(0)) throw new Error('Số lượng thành phẩm phải lớn hơn 0');
  return D(inputCost).div(q).toDecimalPlaces(4);
}

/**
 * Cost of one stock unit of a semi-finished good from its recipe at the latest input prices (for pricing dishes
 * before the next batch is cooked). null when an input has no price yet.
 */
export function theoreticalUnitCost(
  lines: readonly SemiRecipeLine[],
  yieldQty: Num,
  prices: ReadonlyMap<number, Num>,
): Decimal | null {
  const y = D(yieldQty);
  if (y.lte(0) || !lines.length) return null;
  let total = ZERO;
  for (const l of lines) {
    const p = prices.get(l.ingredientId);
    if (p === undefined || p === null) return null;
    total = total.add(D(l.qty).mul(p));
  }
  return total.div(y).toDecimalPlaces(4);
}

/** A production must turn ingredients into the semi-finished good, not into another semi-finished good. */
export function productionProblem(a: {
  outputKind: string;
  inputs: readonly { ingredientId: number; kind: string; qty: Num }[];
  outputId: number;
}): string | null {
  if (a.outputKind !== 'SEMI') return 'Chỉ chế biến được nguyên liệu loại "Bán thành phẩm"';
  if (!a.inputs.length) return 'Nhập nguyên liệu dùng để chế biến';
  if (a.inputs.some((i) => i.ingredientId === a.outputId))
    return 'Bán thành phẩm không dùng chính nó làm nguyên liệu';
  if (a.inputs.some((i) => i.kind === 'SEMI'))
    return 'Nguyên liệu chế biến không được là bán thành phẩm khác';
  if (a.inputs.some((i) => D(i.qty).lte(0))) return 'Số lượng nguyên liệu phải lớn hơn 0';
  return null;
}
