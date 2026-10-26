import { describe, expect, it } from 'vitest';
import { mergeLines, requestProblem, requestTitle } from './table-requests';

const line = (dishId: number, qty = 1, optionIds: number[] = [], note: string | null = null) => ({
  dishId,
  qty,
  optionIds,
  note,
});

describe('table requests (QR)', () => {
  it('checks what guests send', () => {
    expect(requestProblem('ORDER', [line(1, 2)])).toBeNull();
    expect(requestProblem('ORDER', [])).toMatch(/Chọn món/);
    expect(requestProblem('ORDER', [line(1, 21)])).toMatch(/1 đến 20/);
    expect(requestProblem('ORDER', [line(1, 0)])).toMatch(/1 đến 20/);
    expect(
      requestProblem(
        'ORDER',
        Array.from({ length: 31 }, (_, i) => line(i + 1)),
      ),
    ).toMatch(/30 dòng/);
    expect(requestProblem('CALL', [])).toBeNull();
    expect(requestProblem('BILL', [line(1)])).toMatch(/không kèm món/);
  });

  it('merges the same dish with the same options and note', () => {
    expect(
      mergeLines([line(1, 1, [3, 2]), line(1, 2, [2, 3]), line(1, 1, [2]), line(1, 1, [2, 3], ' ít cay ')]),
    ).toEqual([line(1, 3, [2, 3]), line(1, 1, [2]), line(1, 1, [2, 3], 'ít cay')]);
  });

  it('titles for the tills', () => {
    expect(requestTitle('ORDER', 'Bàn 5', [line(1, 2), line(2, 1)])).toBe('Bàn 5 gọi món (3 phần)');
    expect(requestTitle('CALL', 'Bàn 5', [])).toBe('Bàn 5 gọi nhân viên');
    expect(requestTitle('BILL', 'Bàn 5', [])).toBe('Bàn 5 xin thanh toán');
  });
});
