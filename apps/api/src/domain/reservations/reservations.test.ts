import { describe, expect, it } from 'vitest';
import { overlaps, reservationProblem, reservationsLine, shopTime } from './reservations';

describe('reservations', () => {
  it('a table is taken from the booked time for its duration', () => {
    const a = { reservedAt: '2026-10-26T11:00:00.000Z', durationMin: 120 }; // 18:00–20:00
    expect(overlaps(a, { reservedAt: '2026-10-26T12:30:00.000Z', durationMin: 60 })).toBe(true);
    expect(overlaps(a, { reservedAt: '2026-10-26T13:00:00.000Z', durationMin: 60 })).toBe(false);
    expect(overlaps(a, { reservedAt: '2026-10-26T09:30:00.000Z', durationMin: 90 })).toBe(false);
    expect(overlaps(a, { reservedAt: '2026-10-26T09:30:00.000Z', durationMin: 91 })).toBe(true);
    expect(shopTime(a.reservedAt)).toBe('18:00');
  });

  it('checks the time, guests and deposit', () => {
    const now = new Date('2026-10-26T10:00:00.000Z');
    const ok = { reservedAt: '2026-10-26T12:00:00.000Z', guests: 4, deposit: 0, depositMethod: null };
    expect(reservationProblem(ok, now)).toBeNull();
    expect(reservationProblem({ ...ok, reservedAt: '2026-10-26T09:30:00.000Z' }, now)).toBeNull(); // just arrived
    expect(reservationProblem({ ...ok, reservedAt: '2026-10-26T08:30:00.000Z' }, now)).toMatch(/đã qua/);
    expect(reservationProblem({ ...ok, guests: 0 }, now)).toMatch(/khách/);
    expect(reservationProblem({ ...ok, deposit: 200000 }, now)).toMatch(/cách nhận cọc/);
    expect(reservationProblem({ ...ok, deposit: 200000, depositMethod: 'TRANSFER' }, now)).toBeNull();
  });

  it('morning line', () => {
    expect(reservationsLine([])).toBeNull();
    expect(
      reservationsLine([
        { reservedAt: '2026-10-26T04:30:00.000Z', name: 'Nam', guests: 6, tableName: 'Bàn 5' },
        { reservedAt: '2026-10-26T12:00:00.000Z', name: 'Lan <VIP>', guests: 4, tableName: null },
      ]),
    ).toBe('Đặt bàn hôm nay: 2 bàn, 10 khách — 11:30 Nam (6, Bàn 5), 19:00 Lan &lt;VIP&gt; (4)');
  });
});
