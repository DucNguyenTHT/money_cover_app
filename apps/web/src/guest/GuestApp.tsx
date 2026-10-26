import { useCallback, useEffect, useMemo, useState } from 'react';
import { BellRing, CheckCircle2, Clock, Minus, Plus, Receipt, ShoppingBag, X, XCircle } from 'lucide-react';
import type { GuestMenu, GuestRequest } from '@ketoan/api/contracts';
import type { TableRequestKind } from '@ketoan/api/domain';
import { cn } from '@/lib/cn';
import { money } from '@/lib/format';
import { guestApi, tokenFromUrl, type CartLine } from './api';

type Dish = GuestMenu['dishes'][number];
type Group = GuestMenu['groups'][number];

const KIND: Record<TableRequestKind, string> = {
  ORDER: 'Gọi món',
  CALL: 'Gọi nhân viên',
  BILL: 'Xin thanh toán',
};
const sameLine = (a: CartLine, b: CartLine) =>
  a.dishId === b.dishId && a.note === b.note && a.optionIds.join(',') === b.optionIds.join(',');

/** Page guests open from the QR on their table: menu, cart, send; calling staff; the answer of the shop. */
export function GuestApp() {
  const token = useMemo(tokenFromUrl, []);
  const [menu, setMenu] = useState<GuestMenu | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(`ketoan.guest.cart.${token}`) ?? '[]') as CartLine[];
    } catch {
      return [];
    }
  });
  const [mine, setMine] = useState<GuestRequest[]>([]);
  const [picking, setPicking] = useState<Dish | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'good' | 'bad' } | null>(null);
  const [category, setCategory] = useState<number | null>(null);

  useEffect(() => {
    if (!token) return setLoadError('Mã QR không đúng — gọi nhân viên giúp bạn nhé');
    guestApi.menu(token).then(setMenu, (e: Error) => setLoadError(e.message));
  }, [token]);
  useEffect(() => {
    try {
      sessionStorage.setItem(`ketoan.guest.cart.${token}`, JSON.stringify(cart));
    } catch {
      /* private mode: the cart lasts until the page closes */
    }
  }, [cart, token]);

  // The shop's answer: often while something waits, rarely otherwise.
  const refresh = useCallback(() => guestApi.mine(token).then(setMine, () => undefined), [token]);
  const waiting = mine.some((r) => r.status === 'PENDING');
  useEffect(() => {
    if (!menu) return;
    void refresh();
    const t = setInterval(refresh, waiting ? 5_000 : 30_000);
    return () => clearInterval(t);
  }, [menu, refresh, waiting]);

  const flash = (text: string, tone: 'good' | 'bad' = 'good') => {
    setMessage({ text, tone });
    setTimeout(() => setMessage((m) => (m?.text === text ? null : m)), 4000);
  };

  const dishById = useMemo(() => new Map((menu?.dishes ?? []).map((d) => [d.id, d])), [menu]);
  const groupById = useMemo(() => new Map((menu?.groups ?? []).map((g) => [g.id, g])), [menu]);
  const linePrice = (l: CartLine) => {
    const d = dishById.get(l.dishId);
    if (!d) return 0;
    const extra = l.optionIds.reduce((s, id) => {
      for (const gid of d.groupIds) {
        const o = groupById.get(gid)?.options.find((x) => x.id === id);
        if (o) return s + Number(o.price);
      }
      return s;
    }, 0);
    return (Number(d.price) + extra) * l.qty;
  };
  const portions = cart.reduce((s, l) => s + l.qty, 0);
  const total = cart.reduce((s, l) => s + linePrice(l), 0);

  const add = (line: CartLine) =>
    setCart((c) => {
      const i = c.findIndex((x) => sameLine(x, line));
      if (i < 0) return [...c, line];
      return c.map((x, k) => (k === i ? { ...x, qty: Math.min(20, x.qty + line.qty) } : x));
    });
  const bump = (i: number, by: number) =>
    setCart((c) =>
      c.flatMap((x, k) => (k !== i ? [x] : x.qty + by > 0 ? [{ ...x, qty: Math.min(20, x.qty + by) }] : [])),
    );
  const tap = (d: Dish) => {
    if (d.soldOut) return;
    if (d.groupIds.length) setPicking(d);
    else add({ dishId: d.id, qty: 1, optionIds: [], note: null });
  };

  const send = async (kind: TableRequestKind) => {
    setBusy(true);
    try {
      await guestApi.send(
        token,
        kind,
        kind === 'ORDER' ? cart : [],
        kind === 'ORDER' ? note.trim() || null : null,
      );
      if (kind === 'ORDER') {
        setCart([]);
        setNote('');
        setCartOpen(false);
      }
      flash(kind === 'ORDER' ? 'Đã gửi — chờ quán xác nhận nhé' : 'Đã báo nhân viên');
      void refresh();
    } catch (e) {
      flash((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  if (loadError)
    return (
      <Shell>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <XCircle size={40} className="text-bad" />
          <p className="text-base font-semibold">{loadError}</p>
        </div>
      </Shell>
    );
  if (!menu)
    return (
      <Shell>
        <p className="p-6 text-center text-muted">Đang mở thực đơn…</p>
      </Shell>
    );

  const shown = menu.categories.filter((c) => menu.dishes.some((d) => d.categoryId === c.id));
  return (
    <Shell>
      <header className="bg-nav px-4 pb-3 pt-4">
        <h1 className="text-lg font-bold text-ink-strong">{menu.shopName}</h1>
        <p className="text-[13px] text-muted">
          {menu.tableName} · {menu.areaName}
        </p>
      </header>

      {mine.length > 0 && (
        <section
          aria-label="Yêu cầu của bạn"
          className="flex flex-col gap-1.5 border-b border-line bg-white px-4 py-3"
        >
          {mine.slice(0, 3).map((r) => (
            <p key={r.id} className="flex items-start gap-2 text-[13px]">
              {r.status === 'PENDING' ? (
                <Clock size={16} className="mt-0.5 shrink-0 text-warn" />
              ) : r.status === 'ACCEPTED' ? (
                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-good" />
              ) : (
                <XCircle size={16} className="mt-0.5 shrink-0 text-bad" />
              )}
              <span>
                {KIND[r.kind]}
                {r.kind === 'ORDER' ? ` ${r.portions} phần` : ''} ·{' '}
                {r.status === 'PENDING'
                  ? 'đang chờ quán xác nhận'
                  : r.status === 'ACCEPTED'
                    ? r.kind === 'ORDER'
                      ? 'quán đã nhận, món đang được làm'
                      : 'nhân viên đã nhận'
                    : `quán chưa nhận được: ${r.rejectReason ?? ''}`}
              </span>
            </p>
          ))}
        </section>
      )}

      <nav
        aria-label="Nhóm món"
        className="sticky top-0 z-10 flex gap-2 overflow-x-auto border-b border-line bg-white px-4 py-2.5"
      >
        {shown.map((c) => (
          <button
            key={c.id}
            onClick={() => {
              setCategory(c.id);
              document.getElementById(`cat-${c.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            className={cn(
              'shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] font-medium',
              category === c.id ? 'border-primary bg-primary-soft text-primary-ink' : 'border-line bg-white',
            )}
          >
            {c.name}
          </button>
        ))}
      </nav>

      <main className="flex-1 pb-36">
        {shown.map((c) => (
          <section key={c.id} id={`cat-${c.id}`} className="scroll-mt-14">
            <h2 className="px-4 pb-1 pt-4 text-[13px] font-semibold uppercase tracking-wide text-muted">
              {c.name}
            </h2>
            <ul className="divide-y divide-line-soft bg-white">
              {menu.dishes
                .filter((d) => d.categoryId === c.id)
                .map((d) => {
                  const inCart = cart.filter((l) => l.dishId === d.id).reduce((s, l) => s + l.qty, 0);
                  return (
                    <li key={d.id}>
                      <button
                        onClick={() => tap(d)}
                        disabled={d.soldOut}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left disabled:opacity-50"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium text-ink-strong">{d.name}</span>
                          <span className="num text-[13px] text-primary-ink">
                            {d.soldOut ? 'Hết món' : `${money(d.price)} ₫`}
                          </span>
                        </span>
                        {inCart > 0 && (
                          <span className="num rounded-full bg-primary px-2 text-xs font-bold text-white">
                            {inCart}
                          </span>
                        )}
                        {!d.soldOut && (
                          <span className="flex size-9 items-center justify-center rounded-full border border-primary text-primary-ink">
                            <Plus size={18} />
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
            </ul>
          </section>
        ))}
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 shadow-[0_-4px_16px_rgba(16,24,40,0.06)]">
        {message && (
          <p
            role="status"
            className={cn(
              'mb-2 rounded-ctl px-3 py-2 text-[13px] font-medium',
              message.tone === 'good' ? 'bg-good-soft text-good' : 'bg-bad-soft text-bad',
            )}
          >
            {message.text}
          </p>
        )}
        {portions > 0 ? (
          <button
            onClick={() => setCartOpen(true)}
            className="flex h-12 w-full items-center justify-between rounded-ctl bg-primary px-4 font-semibold text-white"
          >
            <span className="flex items-center gap-2">
              <ShoppingBag size={18} /> {portions} phần
            </span>
            <span className="num">Xem & gửi · {money(total)} ₫</span>
          </button>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <button
              disabled={busy}
              onClick={() => send('CALL')}
              className="flex h-12 items-center justify-center gap-2 rounded-ctl border border-line text-sm font-semibold"
            >
              <BellRing size={18} /> Gọi nhân viên
            </button>
            <button
              disabled={busy}
              onClick={() => send('BILL')}
              className="flex h-12 items-center justify-center gap-2 rounded-ctl border border-line text-sm font-semibold"
            >
              <Receipt size={18} /> Xin thanh toán
            </button>
          </div>
        )}
      </footer>

      {picking && (
        <OptionsSheet
          dish={picking}
          groups={picking.groupIds.map((id) => groupById.get(id)!).filter(Boolean)}
          onClose={() => setPicking(null)}
          onAdd={(l) => (add(l), setPicking(null))}
        />
      )}

      {cartOpen && (
        <Sheet title="Món bạn chọn" onClose={() => setCartOpen(false)}>
          <ul className="flex flex-col divide-y divide-line-soft">
            {cart.map((l, i) => {
              const d = dishById.get(l.dishId);
              const opts = l.optionIds
                .map((id) =>
                  d?.groupIds
                    .map((g) => groupById.get(g)?.options.find((o) => o.id === id)?.name)
                    .find(Boolean),
                )
                .filter(Boolean)
                .join(', ');
              return (
                <li key={i} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{d?.name ?? 'Món'}</span>
                    {(opts || l.note) && (
                      <span className="block text-xs text-muted">
                        {[opts, l.note].filter(Boolean).join(' · ')}
                      </span>
                    )}
                    <span className="num text-[13px] text-primary-ink">{money(linePrice(l))} ₫</span>
                  </span>
                  <Stepper
                    value={l.qty}
                    onMinus={() => bump(i, -1)}
                    onPlus={() => bump(i, 1)}
                    label={d?.name ?? 'món'}
                  />
                </li>
              );
            })}
          </ul>
          <label className="mt-2 flex flex-col gap-1 text-[13px] font-medium">
            Ghi chú cho quán
            <input
              value={note}
              maxLength={200}
              onChange={(e) => setNote(e.target.value)}
              placeholder="VD: lên món nước trước"
              className="h-11 rounded-ctl border border-field px-3 text-[15px] font-normal"
            />
          </label>
          <p className="mt-2 text-xs text-faint">Giá tạm tính; khuyến mãi (nếu có) tính khi thanh toán.</p>
          <button
            disabled={busy || portions === 0}
            onClick={() => send('ORDER')}
            className="num mt-3 h-12 w-full rounded-ctl bg-primary font-semibold text-white disabled:opacity-60"
          >
            {busy ? 'Đang gửi…' : `Gửi gọi món · ${money(total)} ₫`}
          </button>
        </Sheet>
      )}
    </Shell>
  );
}

function OptionsSheet({
  dish,
  groups,
  onClose,
  onAdd,
}: {
  dish: Dish;
  groups: Group[];
  onClose: () => void;
  onAdd: (l: CartLine) => void;
}) {
  const [chosen, setChosen] = useState<number[]>(() =>
    groups.flatMap((g) => g.options.filter((o) => o.isDefault).map((o) => o.id)),
  );
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  const toggle = (g: Group, id: number) =>
    setChosen((c) => {
      const mine = g.options.map((o) => o.id);
      if (!g.multi) return [...c.filter((x) => !mine.includes(x)), id];
      if (c.includes(id)) return c.filter((x) => x !== id);
      if (g.maxSelect && c.filter((x) => mine.includes(x)).length >= g.maxSelect) return c;
      return [...c, id];
    });
  const missing = groups.find((g) => g.required && !g.options.some((o) => chosen.includes(o.id)));
  const unit =
    Number(dish.price) +
    groups
      .flatMap((g) => g.options)
      .filter((o) => chosen.includes(o.id))
      .reduce((s, o) => s + Number(o.price), 0);
  return (
    <Sheet title={dish.name} onClose={onClose}>
      <div className="flex flex-col gap-4">
        {groups.map((g) => (
          <fieldset key={g.id}>
            <legend className="mb-1.5 text-[13px] font-semibold">
              {g.name}
              {g.required ? (
                <span className="text-bad"> *</span>
              ) : g.maxSelect ? (
                ` (tối đa ${g.maxSelect})`
              ) : (
                ''
              )}
            </legend>
            <div className="flex flex-col divide-y divide-line-soft rounded-ctl border border-line-soft">
              {g.options.map((o) => (
                <label key={o.id} className="flex items-center gap-3 px-3 py-2.5 text-[15px]">
                  <input
                    type={g.multi ? 'checkbox' : 'radio'}
                    name={`g-${g.id}`}
                    checked={chosen.includes(o.id)}
                    onChange={() => toggle(g, o.id)}
                    className="size-5 accent-[var(--color-primary)]"
                  />
                  <span className="flex-1">{o.name}</span>
                  {Number(o.price) > 0 && (
                    <span className="num text-[13px] text-muted">+{money(o.price)}</span>
                  )}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <label className="flex flex-col gap-1 text-[13px] font-medium">
          Ghi chú món
          <input
            value={note}
            maxLength={100}
            onChange={(e) => setNote(e.target.value)}
            placeholder="VD: ít đá, không hành"
            className="h-11 rounded-ctl border border-field px-3 text-[15px] font-normal"
          />
        </label>
        <div className="flex items-center gap-3">
          <Stepper
            value={qty}
            onMinus={() => setQty((q) => Math.max(1, q - 1))}
            onPlus={() => setQty((q) => Math.min(20, q + 1))}
            label={dish.name}
          />
          <button
            disabled={!!missing}
            onClick={() =>
              onAdd({
                dishId: dish.id,
                qty,
                optionIds: [...chosen].sort((a, b) => a - b),
                note: note.trim() || null,
              })
            }
            className="num h-12 flex-1 rounded-ctl bg-primary font-semibold text-white disabled:opacity-60"
          >
            {missing ? `Chọn ${missing.name}` : `Thêm · ${money(unit * qty)} ₫`}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function Stepper({
  value,
  onMinus,
  onPlus,
  label,
}: {
  value: number;
  onMinus: () => void;
  onPlus: () => void;
  label: string;
}) {
  return (
    <span className="flex h-10 items-center rounded-full border border-field">
      <button
        aria-label={`Bớt ${label}`}
        onClick={onMinus}
        className="flex h-full w-10 items-center justify-center text-muted"
      >
        <Minus size={16} />
      </button>
      <span className="num w-6 text-center font-semibold">{value}</span>
      <button
        aria-label={`Thêm ${label}`}
        onClick={onPlus}
        className="flex h-full w-10 items-center justify-center text-primary-ink"
      >
        <Plus size={16} />
      </button>
    </span>
  );
}

function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[88vh] w-full overflow-y-auto rounded-t-[20px] bg-white px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3"
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-bold">{title}</h2>
          <button
            aria-label="Đóng"
            onClick={onClose}
            className="flex size-9 items-center justify-center rounded-full text-muted"
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col bg-page text-[15px] text-ink">{children}</div>
  );
}
