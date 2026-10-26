import { describe, expect, it } from 'vitest';
import {
  applyPromotions,
  inWindow,
  promoProblem,
  promoStatus,
  weekdayOf,
  type PromoLine,
  type PromoRule,
} from './promotions';

const rule = (r: Partial<PromoRule> & Pick<PromoRule, 'id' | 'kind'>): PromoRule => ({
  startDate: null,
  endDate: null,
  weekdays: [],
  startTime: null,
  endTime: null,
  channels: ['DINE_IN', 'TAKEAWAY'],
  percent: null,
  comboPrice: null,
  items: [],
  ...r,
});
const line = (l: Partial<PromoLine> & Pick<PromoLine, 'dishId' | 'qty'>): PromoLine => ({
  categoryId: 1,
  basePrice: 50000,
  unitPrice: l.basePrice ?? 50000,
  manualDiscount: false,
  minute: 12 * 60,
  ...l,
});
const ctx = { channel: 'DINE_IN', businessDate: '2026-10-26' }; // Monday
const off = (r: { discount: { toString(): string } }[]) => r.map((x) => Number(x.discount.toString()));

describe('promotions', () => {
  it('weekday and time window (crossing midnight too)', () => {
    expect(weekdayOf('2026-10-26')).toBe(1);
    expect(weekdayOf('2026-11-01')).toBe(7);
    const w = { startTime: '14:00', endTime: '17:00' };
    expect([inWindow(w, 13 * 60 + 59), inWindow(w, 14 * 60), inWindow(w, 17 * 60)]).toEqual([
      false,
      true,
      false,
    ]);
    const night = { startTime: '22:00', endTime: '02:00' };
    expect([inWindow(night, 23 * 60), inWindow(night, 60), inWindow(night, 3 * 60)]).toEqual([
      true,
      true,
      false,
    ]);
  });

  it('happy hour: % off covered dishes ordered inside the window, best % wins, hand-discounted lines left out', () => {
    const drinks = rule({
      id: 1,
      kind: 'TIME',
      percent: 20,
      startTime: '14:00',
      endTime: '17:00',
      items: [{ dishId: null, categoryId: 2, qty: 1 }],
    });
    const all = rule({ id: 2, kind: 'TIME', percent: 10, startTime: '14:00', endTime: '17:00' });
    const r = applyPromotions(
      [
        line({ dishId: 10, categoryId: 2, qty: 2, basePrice: 25000, unitPrice: 30000, minute: 15 * 60 }), // drink + topping
        line({ dishId: 11, qty: 1, minute: 15 * 60 }), // food: only "all" 10%
        line({ dishId: 10, categoryId: 2, qty: 1, basePrice: 25000, minute: 17 * 60 + 5 }), // too late
        line({ dishId: 10, categoryId: 2, qty: 1, basePrice: 25000, minute: 15 * 60, manualDiscount: true }),
      ],
      [drinks, all],
      ctx,
    );
    expect(off(r)).toEqual([12000, 5000, 0, 0]);
    expect(r.map((x) => x.promotionId)).toEqual([1, 2, null, null]);
  });

  it('runs only on its days, dates and channels', () => {
    const p = rule({ id: 1, kind: 'TIME', percent: 10 });
    const l = [line({ dishId: 1, qty: 1 })];
    expect(off(applyPromotions(l, [{ ...p, weekdays: [6, 7] }], ctx))).toEqual([0]);
    expect(off(applyPromotions(l, [{ ...p, endDate: '2026-10-25' }], ctx))).toEqual([0]);
    expect(off(applyPromotions(l, [{ ...p, startDate: '2026-10-26', endDate: '2026-10-26' }], ctx))).toEqual([
      5000,
    ]);
    expect(off(applyPromotions(l, [p], { ...ctx, channel: 'APP' }))).toEqual([0]);
  });

  it('combo: as many full sets as the lines make, money off spread by dish price, options still paid', () => {
    // Phở 50.000 + trà đá 5.000 → 49.000 a set.
    const combo = rule({
      id: 7,
      kind: 'COMBO',
      comboPrice: 49000,
      items: [
        { dishId: 1, categoryId: null, qty: 1 },
        { dishId: 2, categoryId: null, qty: 1 },
      ],
    });
    const r = applyPromotions(
      [
        line({ dishId: 1, qty: 3, basePrice: 50000, unitPrice: 60000 }), // with an extra egg
        line({ dishId: 2, qty: 2, basePrice: 5000 }),
      ],
      [combo],
      ctx,
    );
    // 2 sets: (50.000 + 5.000) × 2 − 98.000 = 12.000, split 100.000 : 10.000.
    expect(off(r)).toEqual([10909, 1091]);
    expect(r.map((x) => x.promotionId)).toEqual([7, 7]);
  });

  it('combo first, then happy hour on the portions left; the bigger saving combo takes the dishes first', () => {
    const small = rule({
      id: 1,
      kind: 'COMBO',
      comboPrice: 52000,
      items: [
        { dishId: 1, categoryId: null, qty: 1 },
        { dishId: 2, categoryId: null, qty: 1 },
      ],
    });
    const big = rule({
      id: 2,
      kind: 'COMBO',
      comboPrice: 90000,
      items: [{ dishId: 1, categoryId: null, qty: 2 }],
    });
    const happy = rule({ id: 3, kind: 'TIME', percent: 10 });
    const r = applyPromotions(
      [line({ dishId: 1, qty: 3 }), line({ dishId: 2, qty: 1, basePrice: 5000 })],
      [small, big, happy],
      ctx,
    );
    // big: 2 phở → 10.000 off; small: phở + trà → 3.000 off; nothing left for happy hour.
    expect(off(r)).toEqual([12727, 273]);
    expect(r[0]!.promotionId).toBe(2);
    const r2 = applyPromotions([line({ dishId: 1, qty: 3 })], [big, happy], ctx);
    expect(off(r2)).toEqual([15000]); // 10.000 combo + 10% of the third phở
  });

  it('combo needs every dish, ordered while it was running; never more than the line', () => {
    const combo = rule({
      id: 1,
      kind: 'COMBO',
      comboPrice: 40000,
      startTime: '10:00',
      endTime: '14:00',
      items: [
        { dishId: 1, categoryId: null, qty: 1 },
        { dishId: 2, categoryId: null, qty: 1 },
      ],
    });
    expect(off(applyPromotions([line({ dishId: 1, qty: 1 })], [combo], ctx))).toEqual([0]);
    expect(
      off(
        applyPromotions(
          [line({ dishId: 1, qty: 1 }), line({ dishId: 2, qty: 1, minute: 15 * 60 })],
          [combo],
          ctx,
        ),
      ),
    ).toEqual([0, 0]);
    const free = rule({ id: 2, kind: 'TIME', percent: 100 });
    expect(off(applyPromotions([line({ dishId: 1, qty: 2 })], [free], ctx))).toEqual([100000]);
  });

  it('status and validation', () => {
    expect(promoStatus({ active: true, startDate: '2026-11-01', endDate: null }, '2026-10-26')).toBe(
      'UPCOMING',
    );
    expect(promoStatus({ active: true, startDate: null, endDate: '2026-10-25' }, '2026-10-26')).toBe('ENDED');
    expect(promoStatus({ active: false, startDate: null, endDate: null }, '2026-10-26')).toBe('OFF');
    expect(promoStatus({ active: true, startDate: null, endDate: null }, '2026-10-26')).toBe('RUNNING');
    const base = rule({ id: 0, kind: 'TIME', percent: 20 });
    expect(promoProblem(base)).toBeNull();
    expect(promoProblem({ ...base, percent: 0 })).toMatch(/1 đến 100/);
    expect(promoProblem({ ...base, startTime: '14:00' })).toMatch(/giờ kết thúc/);
    expect(promoProblem({ ...base, channels: [] })).toMatch(/kênh/);
    const c = rule({
      id: 0,
      kind: 'COMBO',
      comboPrice: 49000,
      items: [{ dishId: 1, categoryId: null, qty: 1 }],
    });
    expect(promoProblem(c)).toMatch(/2 phần/);
    expect(promoProblem({ ...c, items: [{ dishId: 1, categoryId: null, qty: 2 }] })).toBeNull();
    expect(
      promoProblem({
        ...c,
        items: [
          { dishId: 1, categoryId: null, qty: 1 },
          { dishId: 1, categoryId: null, qty: 1 },
        ],
      }),
    ).toMatch(/một lần/);
  });
});
