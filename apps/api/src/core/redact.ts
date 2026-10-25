import type { Role } from '../domain/enums';

/** Fields that reveal cost / profit. Staff and kitchen never receive them. */
const SENSITIVE = new Set([
  'costTotal',
  'cost',
  'unitCost',
  'profit',
  'grossProfit',
  'foodCostPct',
  'margin',
  'lossValue',
  'lossTotal',
  'dishAllocations',
  'theoreticalUnitCost',
  'lastUnitCost',
  'estimatedCost',
]);

/** Deep-copy `value` without cost/profit fields unless the viewer is ADMIN. */
export function redactFor<T>(role: Role, value: T): T {
  if (role === 'ADMIN') return value;
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .filter(([k]) => !SENSITIVE.has(k))
          .map(([k, x]) => [k, walk(x)]),
      );
    }
    return v;
  };
  return walk(value) as T;
}
