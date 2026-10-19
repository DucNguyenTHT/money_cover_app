import { describe, expect, it } from 'vitest';
import { consumption } from '../recipes/recipes';
import { defaultOptionIds, needsPicker, optionsLabel, resolveOptions, type OptionGroupDef } from './options';

const opt = (
  id: number,
  name: string,
  price = 0,
  extra: Partial<OptionGroupDef['options'][number]> = {},
) => ({
  id,
  name,
  price,
  recipeFactor: 1,
  isDefault: false,
  active: true,
  ingredients: [],
  ...extra,
});

const EGG = 50;
const BEEF = 51;
const size: OptionGroupDef = {
  id: 1,
  name: 'Size',
  multi: false,
  required: true,
  maxSelect: null,
  active: true,
  options: [opt(1, 'Vừa', 0, { isDefault: true }), opt(2, 'Lớn', 10000, { recipeFactor: 1.5 })],
};
const extra: OptionGroupDef = {
  id: 2,
  name: 'Thêm',
  multi: true,
  required: false,
  maxSelect: 2,
  active: true,
  options: [
    opt(3, 'Trứng', 5000, { ingredients: [{ ingredientId: EGG, qty: 1 }] }),
    opt(4, 'Thịt', 15000, { ingredients: [{ ingredientId: BEEF, qty: '0.05' }] }),
    opt(5, 'Quẩy', 3000),
  ],
};
const request: OptionGroupDef = {
  id: 3,
  name: 'Yêu cầu',
  multi: true,
  required: false,
  maxSelect: null,
  active: true,
  options: [opt(6, 'Ít cay')],
};
const groups = [size, extra, request];

describe('dish options', () => {
  it('adds the price, multiplies the recipe and adds the extra ingredients', () => {
    const r = resolveOptions(groups, [4, 2, 3, 6]);
    if ('error' in r) throw new Error(r.error);
    expect(r.price.toNumber()).toBe(30000);
    expect(r.factor.toNumber()).toBe(1.5);
    expect(r.extras.map((e) => [e.ingredientId, e.qty.toNumber()])).toEqual([
      [EGG, 1],
      [BEEF, 0.05],
    ]);
    expect(r.key).toBe('2,3,4,6');
    expect(optionsLabel(r.chosen)).toBe('Lớn · Trứng, Thịt · Ít cay');
  });

  it('refuses invalid choices', () => {
    expect(resolveOptions(groups, [3])).toEqual({ error: 'Chọn Size' });
    expect(resolveOptions(groups, [1, 2])).toEqual({ error: 'Size: chỉ chọn 1' });
    expect(resolveOptions(groups, [1, 3, 4, 5])).toEqual({ error: 'Thêm: chọn tối đa 2' });
    expect(resolveOptions(groups, [1, 99])).toEqual({ error: 'Tuỳ chọn không dùng cho món này' });
    const off = { ...extra, options: [opt(3, 'Trứng', 5000, { active: false })] };
    expect(resolveOptions([size, off], [1, 3])).toEqual({ error: '"Trứng" đã ngừng dùng' });
  });

  it('defaults: a required group with a default needs no picker', () => {
    expect(defaultOptionIds(groups)).toEqual([1]);
    expect(needsPicker(groups)).toBe(false);
    expect(needsPicker([{ ...size, options: [opt(1, 'Vừa'), opt(2, 'Lớn')] }])).toBe(true);
    const none = resolveOptions([], []);
    expect(none).toMatchObject({ key: '', chosen: [] });
  });

  it('stock: size scales ingredients but not packaging, extras are per portion', () => {
    const used = consumption([
      {
        qty: 2,
        channel: 'TAKEAWAY',
        factor: 1.5,
        recipe: [
          { ingredientId: BEEF, qty: '0.1', scope: 'ALL' },
          { ingredientId: 90, qty: 1, scope: 'TAKEAWAY_APP' },
        ],
        extras: [{ ingredientId: EGG, qty: 1 }],
      },
    ]);
    expect(used.get(BEEF)!.toNumber()).toBe(0.3);
    expect(used.get(90)!.toNumber()).toBe(2);
    expect(used.get(EGG)!.toNumber()).toBe(2);
  });
});
