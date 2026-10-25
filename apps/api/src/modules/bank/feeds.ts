// Clients of the bank-feed services the shop may use: SePay (user API v2) and Casso (API v2). Only money coming
// IN is read. Both are read newest first, page by page, until a transaction already imported shows up.
import { AppError } from '../../core/errors';
import type { BankProvider } from '../../domain/enums';
import { parseShopTime } from '../../domain/bank/match';

export interface FeedTxn {
  externalId: string;
  accountNo: string | null;
  /** Money received, whole đồng, > 0. */
  amount: string;
  description: string;
  reference: string | null;
  bankName: string | null;
  transactedAt: Date;
}

export interface FeedConfig {
  provider: BankProvider;
  token: string;
  /** SePay only: the simulated environment (no real bank). */
  sandbox: boolean;
  /** Keep only this account's transactions (empty = every linked account). */
  accountNo: string | null;
}

export const feedError = (message: string) => new AppError(409, 'BANK_FEED_ERROR', message);
/** The service no longer accepts the key (revoked, mistyped). */
export class FeedAuthError extends Error {}
/** Too many requests: wait `seconds`. */
export class FeedRateLimit extends Error {
  constructor(readonly seconds: number) {
    super(`Dịch vụ báo số dư yêu cầu chờ ${seconds} giây`);
  }
}

const NAMES: Record<BankProvider, string> = { SEPAY: 'SePay', CASSO: 'Casso' };
/** Never read more than this many pages in one run (a first sync of a busy account). */
const MAX_PAGES = 10;

async function getJson(provider: BankProvider, url: string, auth: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { authorization: auth, 'content-type': 'application/json' } });
  } catch {
    throw feedError(`Không kết nối được ${NAMES[provider]} — kiểm tra Internet của máy chủ`);
  }
  if (res.status === 401 || res.status === 403) throw new FeedAuthError(`${NAMES[provider]} từ chối mã API`);
  if (res.status === 429) throw new FeedRateLimit(Number(res.headers.get('retry-after')) || 30);
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const msg = (body as { message?: string } | null)?.message;
    throw feedError(`${NAMES[provider]} báo lỗi ${res.status}${msg ? `: ${msg}` : ''}`);
  }
  return body;
}

const shopDay = (d: Date) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
const shopDateTime = (d: Date) =>
  new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 19).replace('T', ' ');

const digits = (s: unknown) => (s == null ? '' : String(s).replace(/\D/g, ''));
const sameAccount = (want: string | null, got: string | null) =>
  !want || !got || digits(want) === digits(got);

// ---------------------------------------------------------------- SePay

interface SepayTxn {
  id: string;
  transaction_date: string;
  account_number: string | null;
  transfer_type: string;
  amount_in: number | string;
  transaction_content: string | null;
  reference_number: string | null;
  bank_brand_name: string | null;
}

async function sepayPage(cfg: FeedConfig, since: Date, page: number) {
  const base = cfg.sandbox ? 'https://userapi-sandbox.sepay.vn/v2' : 'https://userapi.sepay.vn/v2';
  const q = new URLSearchParams({
    transfer_type: 'in',
    per_page: '100',
    page: String(page),
    transaction_date_sort: 'desc',
    transaction_date_from: shopDateTime(since),
  });
  const body = (await getJson('SEPAY', `${base}/transactions?${q}`, `Bearer ${cfg.token}`)) as {
    status?: string;
    message?: string;
    data?: SepayTxn[];
    meta?: { pagination?: { has_more?: boolean } };
  };
  if (body.status && body.status !== 'success')
    throw feedError(`SePay báo lỗi: ${body.message ?? body.status}`);
  const txns: FeedTxn[] = (body.data ?? [])
    .filter((t) => Number(t.amount_in) > 0 && t.transfer_type !== 'out')
    .map((t) => ({
      externalId: String(t.id),
      accountNo: t.account_number ?? null,
      amount: String(Math.round(Number(t.amount_in))),
      description: t.transaction_content ?? '',
      reference: t.reference_number ?? null,
      bankName: t.bank_brand_name ?? null,
      transactedAt: parseShopTime(t.transaction_date),
    }));
  return { txns, more: !!body.meta?.pagination?.has_more };
}

// ---------------------------------------------------------------- Casso

interface CassoTxn {
  id: number;
  tid: string | null;
  description: string | null;
  amount: number;
  when: string;
  bankSubAccId: string | null;
  bankCodeName: string | null;
}

async function cassoPage(cfg: FeedConfig, since: Date, page: number) {
  const q = new URLSearchParams({
    fromDate: shopDay(since),
    page: String(page),
    pageSize: '100',
    sort: 'DESC',
  });
  const body = (await getJson(
    'CASSO',
    `https://oauth.casso.vn/v2/transactions?${q}`,
    `Apikey ${cfg.token}`,
  )) as {
    error?: number;
    message?: string;
    data?: { records?: CassoTxn[]; nextPage?: number | null; totalPages?: number; page?: number };
  };
  if (body.error) throw feedError(`Casso báo lỗi: ${body.message ?? body.error}`);
  const records = body.data?.records ?? [];
  const txns: FeedTxn[] = records
    .filter((t) => Number(t.amount) > 0)
    .map((t) => ({
      externalId: String(t.id),
      accountNo: t.bankSubAccId ?? null,
      amount: String(Math.round(Number(t.amount))),
      description: t.description ?? '',
      reference: t.tid ?? null,
      bankName: t.bankCodeName ?? null,
      transactedAt: parseShopTime(t.when),
    }));
  const d = body.data;
  const more = !!d && (d.totalPages ?? 0) > (d.page ?? page) && records.length > 0;
  return { txns, more };
}

/** Check a key: read one page of the last day (throws FeedAuthError / feedError). */
export async function testFeed(cfg: FeedConfig): Promise<number> {
  const since = new Date(Date.now() - 86400_000);
  const { txns } = cfg.provider === 'SEPAY' ? await sepayPage(cfg, since, 1) : await cassoPage(cfg, since, 1);
  return txns.filter((t) => sameAccount(cfg.accountNo, t.accountNo)).length;
}

/**
 * Money received since `since`, newest first. Stops at the first page holding a transaction `known` already
 * (everything older was imported before), at the end of the feed, or after MAX_PAGES pages.
 */
export async function fetchRecent(
  cfg: FeedConfig,
  since: Date,
  known: (externalId: string) => boolean,
): Promise<FeedTxn[]> {
  const out: FeedTxn[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { txns, more } =
      cfg.provider === 'SEPAY' ? await sepayPage(cfg, since, page) : await cassoPage(cfg, since, page);
    let reachedKnown = false;
    for (const t of txns) {
      if (known(t.externalId)) {
        reachedKnown = true;
        continue;
      }
      if (t.transactedAt.getTime() < since.getTime() - 86400_000) continue;
      if (!sameAccount(cfg.accountNo, t.accountNo)) continue;
      out.push(t);
    }
    if (reachedKnown || !more) break;
  }
  return out;
}
