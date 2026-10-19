import { describe, expect, it } from 'vitest';
import { backupDue, backupIssue, lastSlot, nextSlot, shopClock } from './schedule';

// 19/10/2026 01:30 and 02:30 shop time (UTC+7).
const before = new Date('2026-10-18T18:30:00Z');
const after = new Date('2026-10-18T19:30:00Z');

describe('backup schedule', () => {
  it('works in shop time', () => {
    expect(shopClock(after)).toEqual({ date: '2026-10-19', hour: 2 });
    expect(lastSlot(after, 2).toISOString()).toBe('2026-10-18T19:00:00.000Z'); // 19/10 02:00
    expect(lastSlot(before, 2).toISOString()).toBe('2026-10-17T19:00:00.000Z'); // 18/10 02:00
    expect(nextSlot(before, 2).toISOString()).toBe('2026-10-18T19:00:00.000Z');
  });

  it('is due once the hour has passed without a good backup since', () => {
    const lastOkAt = '2026-10-17T19:05:00Z'; // 18/10 02:05
    expect(backupDue({ now: before, hour: 2, lastOkAt, lastAttemptAt: lastOkAt })).toBe(false);
    expect(backupDue({ now: after, hour: 2, lastOkAt, lastAttemptAt: lastOkAt })).toBe(true);
    expect(backupDue({ now: after, hour: 2, lastOkAt: null, lastAttemptAt: null })).toBe(true);
  });

  it('retries a failure at most once an hour', () => {
    const args = { now: after, hour: 2, lastOkAt: null };
    expect(backupDue({ ...args, lastAttemptAt: '2026-10-18T19:10:00Z' })).toBe(false);
    expect(backupDue({ ...args, lastAttemptAt: '2026-10-18T18:20:00Z' })).toBe(true);
  });
});

describe('backup issue', () => {
  const ok = { ok: true, drive: null };
  it('reports failures, missing and old backups', () => {
    expect(backupIssue({ now: after, last: null, lastOkAt: null })).toBe('NEVER');
    expect(
      backupIssue({ now: after, last: { ok: false, drive: null }, lastOkAt: '2026-10-18T19:00:00Z' }),
    ).toBe('FAILED');
    expect(backupIssue({ now: after, last: ok, lastOkAt: '2026-10-16T19:00:00Z' })).toBe('STALE');
    expect(backupIssue({ now: after, last: ok, lastOkAt: '2026-10-18T19:00:00Z' })).toBeNull();
    expect(
      backupIssue({ now: after, last: { ok: true, drive: { ok: false } }, lastOkAt: '2026-10-18T19:00:00Z' }),
    ).toBe('DRIVE_FAILED');
  });
});
