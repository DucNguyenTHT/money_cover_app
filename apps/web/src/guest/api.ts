// The guest page talks to the public routes only, with plain fetch (no app client: keeps the page small).
import type { GuestMenu, GuestRequest } from '@ketoan/api/contracts';
import type { TableRequestKind } from '@ketoan/api/domain';

export interface CartLine {
  dishId: number;
  qty: number;
  optionIds: number[];
  note: string | null;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  } catch {
    throw new Error('Không kết nối được tới quán — kiểm tra Wi-Fi của quán rồi thử lại');
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? 'Có lỗi, thử lại sau ít phút');
  return body as T;
}

/** "/t/<code>" (production) or "?t=<code>". */
export const tokenFromUrl = () =>
  location.pathname.match(/^\/t\/([A-Za-z0-9_-]{8,64})/)?.[1] ??
  new URLSearchParams(location.search).get('t') ??
  '';

/** Random id of this phone: it only sees its own requests. */
export function clientId(): string {
  const KEY = 'ketoan.guest.client';
  try {
    const have = localStorage.getItem(KEY);
    if (have) return have;
    const id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export const guestApi = {
  menu: (token: string) => call<GuestMenu>(`/api/public/t/${token}`),
  send: (token: string, kind: TableRequestKind, items: CartLine[], note: string | null) =>
    call<GuestRequest>(`/api/public/t/${token}/requests`, {
      method: 'POST',
      body: JSON.stringify({ clientId: clientId(), kind, items, note }),
    }),
  mine: (token: string) =>
    call<GuestRequest[]>(`/api/public/t/${token}/requests?clientId=${encodeURIComponent(clientId())}`),
};
