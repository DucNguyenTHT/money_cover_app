import { describe, expect, it } from 'vitest';
import { changeRight, OWN_EDIT_WINDOW_MS } from './permissions';

const now = Date.parse('2026-10-16T10:00:00Z');
const at = (msAgo: number) => new Date(now - msAgo).toISOString();
const staff = { id: 2, role: 'STAFF' as const };
const admin = { id: 1, role: 'ADMIN' as const };

describe('changeRight', () => {
  it('lets the uploader fix their own item for 24 hours without a reason', () => {
    expect(changeRight(staff, { createdById: 2, createdAt: at(60_000) }, now)).toBe('FREE');
    expect(changeRight(admin, { createdById: 1, createdAt: at(60_000) }, now)).toBe('FREE');
  });

  it('after that (or for someone else’s item) only ADMIN, with a reason', () => {
    expect(changeRight(staff, { createdById: 2, createdAt: at(OWN_EDIT_WINDOW_MS + 1) }, now)).toBe('NO');
    expect(changeRight(staff, { createdById: 9, createdAt: at(1000) }, now)).toBe('NO');
    expect(changeRight(admin, { createdById: 9, createdAt: at(1000) }, now)).toBe('WITH_REASON');
    expect(changeRight(admin, { createdById: 1, createdAt: at(OWN_EDIT_WINDOW_MS + 1) }, now)).toBe(
      'WITH_REASON',
    );
  });
});
