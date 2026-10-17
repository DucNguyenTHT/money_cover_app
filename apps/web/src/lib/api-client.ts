import { initClient, tsRestFetchApi } from '@ts-rest/core';
import { api, type ApiError } from '@ketoan/api/contracts';

const TOKEN_KEY = 'ketoan.token';

export const tokenStore = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (t: string | null) => {
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage unavailable: session lasts until reload */
    }
  },
};

/** Fired when the server says the session is no longer valid. */
export const onUnauthorized = new EventTarget();

export const client = initClient(api, {
  baseUrl: '',
  baseHeaders: {},
  api: async (args) => {
    const token = tokenStore.get();
    const res = await tsRestFetchApi({
      ...args,
      headers: { ...args.headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
    if (res.status === 401 && token) onUnauthorized.dispatchEvent(new Event('unauthorized'));
    return res;
  },
});

/** Error thrown by `ok()` for non-2xx responses; carries the server's code and message. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Unwrap a ts-rest response: return the 2xx body or throw HttpError. */
export function ok<R extends { status: number; body: unknown }>(
  res: R,
): Extract<R, { status: 200 | 201 }>['body'] {
  if (res.status >= 200 && res.status < 300) return res.body as Extract<R, { status: 200 | 201 }>['body'];
  const err = (res.body as ApiError | undefined)?.error;
  throw new HttpError(
    res.status,
    err?.code ?? 'HTTP_' + res.status,
    err?.message ?? 'Có lỗi xảy ra',
    err?.details,
  );
}

export const errorMessage = (e: unknown) =>
  e instanceof HttpError ? e.message : e instanceof Error ? e.message : 'Có lỗi xảy ra';
