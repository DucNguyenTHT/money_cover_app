import { describe, expect, it } from 'vitest';
import { archiveBaseName, documentFolderName, uniqueNames, windowsSafe } from './archive-names';

describe('archive names', () => {
  it('builds a readable folder per document', () => {
    expect(
      documentFolderName({
        date: '2026-10-03',
        kindLabel: 'Mua vào',
        partner: 'Chợ Bình Điền',
        number: '0004512',
      }),
    ).toBe('2026-10-03 Mua vào - Chợ Bình Điền (HĐ 0004512)');
    expect(documentFolderName({ date: '2026-10-03', kindLabel: 'Khác', partner: null, number: null })).toBe(
      '2026-10-03 Khác - Không rõ đối tác',
    );
  });

  it('strips characters Windows refuses and trailing dots', () => {
    expect(windowsSafe('Cty A/B: "Bia" <SG>?*|.  ')).toBe('Cty AB Bia SG');
    expect(windowsSafe('...')).toBe('_');
    expect(windowsSafe('x'.repeat(150))).toHaveLength(100);
  });

  it('never repeats a name (ignoring case)', () => {
    expect(uniqueNames(['a.jpg', 'A.jpg', 'a.jpg', 'b'])).toEqual(['a.jpg', 'A (2).jpg', 'a (3).jpg', 'b']);
  });

  it('names the archive after the period', () => {
    expect(archiveBaseName('2026-10')).toBe('chung-tu-2026-10');
    expect(archiveBaseName('2026')).toBe('chung-tu-2026');
  });
});
