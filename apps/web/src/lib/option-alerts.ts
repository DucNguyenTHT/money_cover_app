import type { OptionPricingDto, PricingRow } from '@ketoan/api/contracts';

export interface OptionAlertRow extends OptionPricingDto {
  key: string;
  /** The dish it was judged with: sizes depend on the dish; an add-on costs the same on every dish (null). */
  dishId: number | null;
  dishName: string | null;
}

/** Options with an alert, once each: an add-on shared by many dishes is listed once, a size once per dish. */
export function optionAlertRows(rows: readonly PricingRow[]): OptionAlertRow[] {
  const out = new Map<string, OptionAlertRow>();
  for (const r of rows)
    for (const o of r.options) {
      if (!o.alert) continue;
      const perDish = o.kind === 'SIZE';
      const key = perDish ? `${o.optionId}-${r.dishId}` : String(o.optionId);
      if (!out.has(key))
        out.set(key, { ...o, key, dishId: perDish ? r.dishId : null, dishName: perDish ? r.name : null });
    }
  return [...out.values()];
}
