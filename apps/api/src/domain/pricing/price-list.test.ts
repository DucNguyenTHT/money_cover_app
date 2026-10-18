import { describe, expect, it } from 'vitest';
import { ownAppPrices, sellingPrice, type PriceEntry } from './price-list';

const GRAB = 1;
const SHOPEE = 2;
const BE = 3;
const prices: PriceEntry[] = [
  { priceType: 'STORE', deliveryAppId: null, effectiveFrom: '2026-01-01', price: '50000' },
  { priceType: 'STORE', deliveryAppId: null, effectiveFrom: '2026-06-01', price: '55000' },
  { priceType: 'APP', deliveryAppId: null, effectiveFrom: '2026-01-01', price: '65000' },
  { priceType: 'APP', deliveryAppId: GRAB, effectiveFrom: '2026-03-01', price: '72000' },
  { priceType: 'APP', deliveryAppId: SHOPEE, effectiveFrom: '2026-12-01', price: '69000' },
];

describe('selling price per channel and app', () => {
  it('dine-in and takeaway use the store price in force', () => {
    expect(sellingPrice(prices, 'DINE_IN', null, '2026-05-31')).toBe('50000');
    expect(sellingPrice(prices, 'TAKEAWAY', null, '2026-06-01')).toBe('55000');
  });

  it('an app uses its own price, then the general app price', () => {
    expect(sellingPrice(prices, 'APP', GRAB, '2026-07-01')).toBe('72000');
    expect(sellingPrice(prices, 'APP', GRAB, '2026-02-01')).toBe('65000'); // own price not yet in force
    expect(sellingPrice(prices, 'APP', SHOPEE, '2026-07-01')).toBe('65000');
    expect(sellingPrice(prices, 'APP', BE, '2026-07-01')).toBe('65000');
  });

  it('falls back to the store price when no app price exists', () => {
    const storeOnly = prices.filter((p) => p.priceType === 'STORE');
    expect(sellingPrice(storeOnly, 'APP', GRAB, '2026-07-01')).toBe('55000');
  });

  it('lists only the own prices in force', () => {
    expect(ownAppPrices(prices, '2026-07-01')).toEqual([{ deliveryAppId: GRAB, price: '72000' }]);
  });
});
