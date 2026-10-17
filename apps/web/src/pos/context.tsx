import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { OrderDto } from '@ketoan/api/contracts';
import type { Channel } from '@ketoan/api/domain';
import { client, errorMessage, HttpError, ok } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import { posKeys } from './data';

/** What the order panel is showing: an existing order, or a new one not created until the first dish. */
export type PosTarget =
  | { orderId: number }
  | {
      draft: {
        channel: Channel;
        tableId: number | null;
        tableName?: string;
        deliveryAppId: number | null;
        appOrderCode: string | null;
      };
    }
  | null;

interface PosState {
  target: PosTarget;
  setTarget: (t: PosTarget) => void;
  search: string;
  setSearch: (s: string) => void;
  /** Add one portion of a dish to the target (creates the order on the first dish). Calls are queued. */
  addDish: (dishId: number, qty?: number) => void;
  pending: number;
}

const Ctx = createContext<PosState | null>(null);
const KEY = 'ketoan.pos.order';

function loadTarget(): PosTarget {
  try {
    const id = Number(sessionStorage.getItem(KEY));
    return id ? { orderId: id } : null;
  } catch {
    return null;
  }
}

export function PosProvider({ children }: { children: ReactNode }) {
  const [target, setTargetState] = useState<PosTarget>(loadTarget);
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState(0);
  const qc = useQueryClient();
  const toast = useToast();
  const chain = useRef(Promise.resolve());
  const targetRef = useRef(target);
  targetRef.current = target;

  const setTarget = useCallback((t: PosTarget) => {
    targetRef.current = t;
    setTargetState(t);
    try {
      if (t && 'orderId' in t) sessionStorage.setItem(KEY, String(t.orderId));
      else sessionStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const addDish = useCallback(
    (dishId: number, qty = 1) => {
      setPending((n) => n + 1);
      chain.current = chain.current
        .then(async () => {
          const t = targetRef.current;
          if (!t) {
            toast('Chọn bàn hoặc "Mang về" trước khi gọi món', 'bad');
            return;
          }
          const add = async (order: OrderDto) =>
            ok(
              await client.orders.addItems({
                params: { id: order.id },
                body: { version: order.version, items: [{ dishId, qty }] },
              }),
            );
          let o: OrderDto;
          if ('draft' in t) {
            const d = t.draft;
            o = ok(
              await client.orders.open({
                body: {
                  channel: d.channel,
                  tableId: d.tableId,
                  deliveryAppId: d.deliveryAppId,
                  appOrderCode: d.appOrderCode,
                  guestCount: 1,
                  note: null,
                  items: [{ dishId, qty }],
                },
              }),
            );
            setTarget({ orderId: o.id });
          } else {
            const cached =
              qc.getQueryData<OrderDto>(posKeys.order(t.orderId)) ??
              ok(await client.orders.get({ params: { id: t.orderId } }));
            try {
              o = await add(cached);
            } catch (e) {
              if (!(e instanceof HttpError && e.code === 'STALE_ORDER')) throw e;
              o = await add(ok(await client.orders.get({ params: { id: t.orderId } })));
            }
          }
          qc.setQueryData(posKeys.order(o.id), o);
          qc.invalidateQueries({ queryKey: posKeys.floor });
        })
        .catch((e) => toast(errorMessage(e), 'bad'))
        .finally(() => setPending((n) => n - 1));
    },
    [qc, setTarget, toast],
  );

  const value = useMemo(
    () => ({ target, setTarget, search, setSearch, addDish, pending }),
    [target, setTarget, search, addDish, pending],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Null outside /pos (e.g. the admin copy of the order list). */
export const usePosMaybe = () => useContext(Ctx);

export function usePos() {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePos outside PosProvider');
  return v;
}
