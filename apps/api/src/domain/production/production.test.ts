import { describe, expect, it } from 'vitest';
import { productionProblem, productionUnitCost, scaleRecipe, theoreticalUnitCost } from './production';

const broth = [
  { ingredientId: 1, qty: '10' }, // 10 kg bones
  { ingredientId: 2, qty: '0.5' }, // 0.5 kg spices
];

describe('production', () => {
  it('scales one batch to the pot actually cooked', () => {
    expect(scaleRecipe(broth, '40', '60').map((l) => [l.ingredientId, l.qty.toString()])).toEqual([
      [1, '15'],
      [2, '0.75'],
    ]);
    expect(() => scaleRecipe(broth, 0, 10)).toThrow();
  });

  it('unit cost = what the inputs cost ÷ what came out', () => {
    // 10 kg bones at 100.000 + 0.5 kg spices at 200.000 = 1.100.000 for 38 litres.
    expect(productionUnitCost('1100000', '38').toString()).toBe('28947.3684');
    expect(() => productionUnitCost(1, 0)).toThrow();
  });

  it('theoretical cost from the recipe at the latest prices', () => {
    const prices = new Map<number, string>([
      [1, '100000'],
      [2, '200000'],
    ]);
    expect(theoreticalUnitCost(broth, '40', prices)?.toString()).toBe('27500');
    expect(theoreticalUnitCost(broth, '40', new Map([[1, '100000']]))).toBeNull();
  });

  it('only ingredients go in, a semi-finished good comes out', () => {
    const ok = { outputKind: 'SEMI', outputId: 9, inputs: [{ ingredientId: 1, kind: 'INGREDIENT', qty: 1 }] };
    expect(productionProblem(ok)).toBeNull();
    expect(productionProblem({ ...ok, outputKind: 'INGREDIENT' })).toContain('Bán thành phẩm');
    expect(productionProblem({ ...ok, inputs: [] })).toContain('Nhập nguyên liệu');
    expect(productionProblem({ ...ok, inputs: [{ ingredientId: 3, kind: 'SEMI', qty: 1 }] })).toContain(
      'bán thành phẩm khác',
    );
    expect(productionProblem({ ...ok, inputs: [{ ingredientId: 9, kind: 'SEMI', qty: 1 }] })).toContain(
      'chính nó',
    );
  });
});
