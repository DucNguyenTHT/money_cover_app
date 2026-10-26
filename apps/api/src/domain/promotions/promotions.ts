// Automatic promotions on open orders: happy hour (giờ vàng, % off dishes in a time window) and combos
// (a set of dishes sold at one price). Worked out again every time the order changes.
import { allocateVnd, D, Decimal, roundVnd, sum, ZERO, type Num } from '../money';
import type { PromotionKind } from '../enums';

export interface PromoRule {
  id: number;
  kind: PromotionKind;
  /** Business dates (YYYY-MM-DD), inclusive; null = open-ended. */
  startDate: string | null;
  endDate: string | null;
  /** 1 = Monday … 7 = Sunday, of the business date; empty = every day. */
  weekdays: number[];
  /** "HH:MM" of the time the line was ordered; both null = all day; start > end crosses midnight. */
  startTime: string | null;
  endTime: string | null;
  channels: string[];
  /** TIME: % off the line price (options included). */
  percent: Num | null;
  /** COMBO: price of one set, on dish prices (options are still paid on top). */
  comboPrice: Num | null;
  /** COMBO: dishes and portions per set. TIME: dishes or categories it covers (none = whole menu). */
  items: { dishId: number | null; categoryId: number | null; qty: number }[];
}

export interface PromoLine {
  dishId: number;
  categoryId: number;
  qty: number;
  /** Dish price for the channel, without options. */
  basePrice: Num;
  /** basePrice + options. */
  unitPrice: Num;
  /** Lines discounted by hand get no promotion (no double discount). */
  manualDiscount: boolean;
  /** Minutes after local midnight when the line was ordered. */
  minute: number;
}

export interface PromoContext {
  channel: string;
  businessDate: string;
}

export interface LinePromo {
  discount: Decimal;
  promotionId: number | null;
}

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
};

/** 1 = Monday … 7 = Sunday. */
export function weekdayOf(isoDate: string): number {
  const d = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Runs on that business date and channel (time of day not checked). */
export function runsOn(p: PromoRule, ctx: PromoContext): boolean {
  if (!p.channels.includes(ctx.channel)) return false;
  if (p.startDate && ctx.businessDate < p.startDate) return false;
  if (p.endDate && ctx.businessDate > p.endDate) return false;
  return p.weekdays.length === 0 || p.weekdays.includes(weekdayOf(ctx.businessDate));
}

/** The time window holds `minute` (after local midnight). */
export function inWindow(p: Pick<PromoRule, 'startTime' | 'endTime'>, minute: number): boolean {
  if (!p.startTime || !p.endTime) return true;
  const a = minutes(p.startTime);
  const b = minutes(p.endTime);
  return a <= b ? minute >= a && minute < b : minute >= a || minute < b;
}

const covers = (p: PromoRule, l: PromoLine) =>
  p.items.length === 0 || p.items.some((i) => i.dishId === l.dishId || i.categoryId === l.categoryId);

/**
 * Promotion money off per line. Combos first (biggest saving per set first, as many full sets as the lines make),
 * then the best happy-hour % on what is left. A combo only uses portions ordered while it was running.
 */
export function applyPromotions(lines: PromoLine[], rules: PromoRule[], ctx: PromoContext): LinePromo[] {
  // Money off per line and promotion; the line is labelled with the promotion giving the most.
  const parts = lines.map(() => new Map<number, Decimal>());
  const give = (i: number, id: number, off: Decimal) =>
    parts[i]!.set(id, (parts[i]!.get(id) ?? ZERO).add(off));
  const left = lines.map((l) => (l.manualDiscount ? 0 : l.qty));
  const running = rules.filter((p) => runsOn(p, ctx));

  const baseOf = (dishId: number) => lines.find((l) => l.dishId === dishId)?.basePrice;
  const combos = running
    .filter((p) => p.kind === 'COMBO' && p.comboPrice != null && p.items.length > 0)
    .map((p) => {
      const prices = p.items.map((i) => (i.dishId == null ? undefined : baseOf(i.dishId)));
      const saving = prices.every((x) => x !== undefined)
        ? sum(p.items.map((i, k) => D(prices[k]!).mul(i.qty))).sub(p.comboPrice!)
        : ZERO;
      return { p, saving };
    })
    .filter((c) => c.saving.gt(0))
    .sort((a, b) => b.saving.cmp(a.saving) || a.p.id - b.p.id);

  for (const { p } of combos) {
    const eligible = (dishId: number) =>
      lines
        .map((l, i) => i)
        .filter((i) => lines[i]!.dishId === dishId && left[i]! > 0 && inWindow(p, lines[i]!.minute));
    const sets = Math.min(
      ...p.items.map((it) => Math.floor(eligible(it.dishId!).reduce((s, i) => s + left[i]!, 0) / it.qty)),
    );
    if (sets <= 0) continue;
    const taken = new Map<number, number>();
    for (const it of p.items) {
      let need = it.qty * sets;
      for (const i of eligible(it.dishId!)) {
        const n = Math.min(need, left[i]!);
        taken.set(i, (taken.get(i) ?? 0) + n);
        left[i]! -= n;
        need -= n;
        if (!need) break;
      }
    }
    const idx = [...taken.keys()];
    const weights = idx.map((i) => D(lines[i]!.basePrice).mul(taken.get(i)!));
    const off = Decimal.max(ZERO, sum(weights).sub(D(p.comboPrice!).mul(sets)));
    allocateVnd(off, weights).forEach((share, k) => {
      give(idx[k]!, p.id, share);
    });
  }

  const happy = running.filter((p) => p.kind === 'TIME' && p.percent != null && D(p.percent).gt(0));
  lines.forEach((l, i) => {
    if (left[i]! <= 0) return;
    let best: PromoRule | null = null;
    for (const p of happy)
      if (covers(p, l) && inWindow(p, l.minute) && (!best || D(p.percent!).gt(best.percent!))) best = p;
    if (!best) return;
    const off = roundVnd(
      D(l.unitPrice)
        .mul(left[i]!)
        .mul(Decimal.min(D(best.percent!), 100))
        .div(100),
    );
    give(i, best.id, off);
  });

  return parts.map((m, i) => {
    const top = [...m.entries()].filter(([, v]) => v.gt(0)).sort((a, b) => b[1].cmp(a[1]) || a[0] - b[0])[0];
    // Never more than the line is worth.
    const discount = Decimal.min(sum([...m.values()]), roundVnd(D(lines[i]!.unitPrice).mul(lines[i]!.qty)));
    return { discount, promotionId: top ? top[0] : null };
  });
}

export type PromoStatus = 'OFF' | 'UPCOMING' | 'RUNNING' | 'ENDED';

/** Where a promotion stands on business date `today`. */
export function promoStatus(
  p: { active: boolean; startDate: string | null; endDate: string | null },
  today: string,
): PromoStatus {
  if (!p.active) return 'OFF';
  if (p.endDate && today > p.endDate) return 'ENDED';
  if (p.startDate && today < p.startDate) return 'UPCOMING';
  return 'RUNNING';
}

/** Why a promotion cannot be saved (null = fine). */
export function promoProblem(p: Omit<PromoRule, 'id'>): string | null {
  if (p.startDate && p.endDate && p.startDate > p.endDate) return 'Ngày kết thúc phải sau ngày bắt đầu';
  if (!p.startTime !== !p.endTime)
    return 'Nhập đủ giờ bắt đầu và giờ kết thúc (hoặc bỏ trống cả hai = cả ngày)';
  if (p.startTime && p.startTime === p.endTime) return 'Giờ bắt đầu và kết thúc trùng nhau';
  if (p.channels.length === 0) return 'Chọn ít nhất một kênh bán';
  if (p.kind === 'TIME') {
    if (p.percent == null || D(p.percent).lte(0) || D(p.percent).gt(100)) return 'Mức giảm từ 1 đến 100%';
    if (p.items.some((i) => i.dishId == null && i.categoryId == null)) return 'Chọn món hoặc nhóm món';
    return null;
  }
  if (p.items.length === 0 || p.items.some((i) => i.dishId == null || i.qty < 1))
    return 'Combo cần các món và số phần';
  if (new Set(p.items.map((i) => i.dishId)).size !== p.items.length)
    return 'Mỗi món chỉ ghi một lần (tăng số phần)';
  if (p.items.reduce((s, i) => s + i.qty, 0) < 2) return 'Combo cần ít nhất 2 phần';
  if (p.comboPrice == null || D(p.comboPrice).lte(0)) return 'Nhập giá combo';
  return null;
}
