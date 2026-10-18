import { PRICE_TYPE_BY_CHANNEL, type Channel, type PriceType } from '../enums';

export interface PriceEntry {
  priceType: PriceType;
  /** APP prices only: the app this price is for; null = every app without its own price. */
  deliveryAppId: number | null;
  effectiveFrom: string;
  price: string;
}

/** Price of exactly this type and app in force on `date`. */
export function priceInForce(
  prices: readonly PriceEntry[],
  type: PriceType,
  appId: number | null,
  date: string,
): string | null {
  let best: PriceEntry | null = null;
  for (const p of prices) {
    if (p.priceType !== type || p.deliveryAppId !== appId || p.effectiveFrom > date) continue;
    if (!best || p.effectiveFrom > best.effectiveFrom) best = p;
  }
  return best?.price ?? null;
}

/**
 * Selling price of a dish for a sale: store price for dine-in / takeaway; for an app order the app's own price,
 * else the general app price, else the store price.
 */
export function sellingPrice(
  prices: readonly PriceEntry[],
  channel: Channel,
  appId: number | null,
  date: string,
): string | null {
  const store = priceInForce(prices, 'STORE', null, date);
  if (PRICE_TYPE_BY_CHANNEL[channel] === 'STORE') return store;
  return (
    (appId !== null ? priceInForce(prices, 'APP', appId, date) : null) ??
    priceInForce(prices, 'APP', null, date) ??
    store
  );
}

/** Apps with their own price in force on `date` (the rest use the general app price). */
export function ownAppPrices(prices: readonly PriceEntry[], date: string) {
  const ids = [...new Set(prices.flatMap((p) => (p.deliveryAppId !== null ? [p.deliveryAppId] : [])))];
  return ids.flatMap((id) => {
    const price = priceInForce(prices, 'APP', id, date);
    return price === null ? [] : [{ deliveryAppId: id, price }];
  });
}
