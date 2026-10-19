// Options of a dish (size, toppings, requests): which choices are valid, what they add to the price and to the
// ingredients used. Groups are shared by many dishes; a dish uses the groups attached to it.
import { D, Decimal, ZERO, type Num } from '../money';

export interface OptionDef {
  id: number;
  name: string;
  /** Added to the dish price, every channel. */
  price: Num;
  /** Multiplies the dish recipe (size); 1 = unchanged. */
  recipeFactor: Num;
  isDefault: boolean;
  active: boolean;
  /** Extra ingredients per portion, stock units. */
  ingredients: readonly { ingredientId: number; qty: Num }[];
}

export interface OptionGroupDef {
  id: number;
  name: string;
  /** false = pick one (size), true = pick several (toppings). */
  multi: boolean;
  required: boolean;
  maxSelect: number | null;
  active: boolean;
  options: readonly OptionDef[];
}

export interface ChosenOption {
  optionId: number;
  groupName: string;
  name: string;
  price: Decimal;
}

export interface ResolvedOptions {
  chosen: ChosenOption[];
  /** Sum of the options' prices. */
  price: Decimal;
  /** Product of the options' recipe factors. */
  factor: Decimal;
  /** Extra ingredients per portion, summed by ingredient. */
  extras: { ingredientId: number; qty: Decimal }[];
  /** Same options ⇒ same key (lines merge only when equal). */
  key: string;
}

/** Options picked when the cashier does not choose: the defaults of the dish's groups. */
export function defaultOptionIds(groups: readonly OptionGroupDef[]): number[] {
  return groups
    .filter((g) => g.active)
    .flatMap((g) => g.options.filter((o) => o.active && o.isDefault).map((o) => o.id))
    .slice();
}

/** A dish whose groups need a choice the defaults do not make: the POS opens the picker. */
export function needsPicker(groups: readonly OptionGroupDef[]): boolean {
  return groups.some((g) => g.active && g.required && !g.options.some((o) => o.active && o.isDefault));
}

/**
 * Check the options picked for one line against the dish's groups and work out price, recipe factor and extra
 * ingredients. Returns an error message when the choice is not valid.
 */
export function resolveOptions(
  groups: readonly OptionGroupDef[],
  optionIds: readonly number[],
): ResolvedOptions | { error: string } {
  const ids = [...new Set(optionIds)];
  const chosen: ChosenOption[] = [];
  let price = ZERO;
  let factor = D(1);
  const extras = new Map<number, Decimal>();
  const used = new Set<number>();

  for (const g of groups) {
    if (!g.active) continue;
    const picked = g.options.filter((o) => ids.includes(o.id));
    if (picked.some((o) => !o.active))
      return { error: `"${picked.find((o) => !o.active)!.name}" đã ngừng dùng` };
    if (g.required && picked.length === 0) return { error: `Chọn ${g.name}` };
    if (!g.multi && picked.length > 1) return { error: `${g.name}: chỉ chọn 1` };
    if (g.multi && g.maxSelect !== null && picked.length > g.maxSelect)
      return { error: `${g.name}: chọn tối đa ${g.maxSelect}` };
    for (const o of picked) {
      used.add(o.id);
      chosen.push({ optionId: o.id, groupName: g.name, name: o.name, price: D(o.price) });
      price = price.add(o.price);
      factor = factor.mul(o.recipeFactor);
      for (const i of o.ingredients)
        extras.set(i.ingredientId, (extras.get(i.ingredientId) ?? ZERO).add(i.qty));
    }
  }
  if (ids.some((id) => !used.has(id))) return { error: 'Tuỳ chọn không dùng cho món này' };
  return {
    chosen,
    price,
    factor,
    extras: [...extras].map(([ingredientId, qty]) => ({ ingredientId, qty })),
    key: chosen
      .map((c) => c.optionId)
      .sort((a, b) => a - b)
      .join(','),
  };
}

/** "Lớn · + Trứng, + Thịt · Ít cay": options of a line, grouped, for the order panel / bill / kitchen. */
export function optionsLabel(chosen: readonly { groupName: string; name: string }[]): string {
  const byGroup = new Map<string, string[]>();
  for (const c of chosen) byGroup.set(c.groupName, [...(byGroup.get(c.groupName) ?? []), c.name]);
  return [...byGroup.values()].map((names) => names.join(', ')).join(' · ');
}
