// Money received on the shop's bank account, read from a bank-feed service (SePay or Casso), matched to orders.
// The VietQR on the payment screen and the bill carries the order code, so most transfers match by themselves;
// a till waiting on its payment screen catches a transfer of exactly its amount without the code. The ADMIN
// enters the service key (sealed) in Settings; stored under KEY, outside the public settings schema.
import type { BankTransaction, Prisma } from '@prisma/client';
import { prisma, type Db } from '../../core/db';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors';
import { writeAudit } from '../../core/audit';
import { defaultBranchId } from '../../core/branch';
import { logger } from '../../core/logger';
import { emit } from '../../core/realtime';
import { open, seal } from '../../core/secret-box';
import type { AuthUser } from '../../core/auth';
import { socketRooms } from '../../contracts/socket-events';
import type {
  BankFeedStatus,
  BankTxnDto,
  DayTransfer,
  TransferOrderDto,
} from '../../contracts/bank.contract';
import { businessDateOf, fromDbDate, toDbDate } from '../../domain/business-date';
import type { BankProvider } from '../../domain/enums';
import { codeInDescription, orderByAmount, transferCheck, transferSummary } from '../../domain/bank/match';
import { D, ZERO } from '../../domain/money';
import { vnd } from '../../domain/notify/messages';
import { businessToday, getSettings } from '../settings/settings.service';
import { FeedAuthError, FeedRateLimit, fetchRecent, testFeed, type FeedConfig, type FeedTxn } from './feeds';

const KEY = 'bank_feed';
const SEAL = 'bank-feed-token';

interface Stored {
  provider: BankProvider;
  token: string; // sealed
  sandbox: boolean;
  accountNo: string | null;
  enabled: boolean;
  lastSyncAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
}

async function load(): Promise<Stored | null> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  return (row?.value as Stored | undefined) ?? null;
}

async function save(v: Stored | null) {
  if (!v) return void (await prisma.setting.deleteMany({ where: { key: KEY } }));
  const value = v as unknown as Prisma.InputJsonValue;
  await prisma.setting.upsert({ where: { key: KEY }, update: { value }, create: { key: KEY, value } });
}

const toStatus = (s: Stored | null): BankFeedStatus => ({
  provider: s?.provider ?? null,
  configured: !!s,
  enabled: !!s?.enabled,
  sandbox: !!s?.sandbox,
  accountNo: s?.accountNo ?? null,
  lastSyncAt: s?.lastSyncAt ?? null,
  lastOkAt: s?.lastOkAt ?? null,
  lastError: s?.lastError ?? null,
});

export const status = async () => toStatus(await load());
export const isEnabled = async () => !!(await load())?.enabled;

const PROVIDER_NAME: Record<BankProvider, string> = { SEPAY: 'SePay', CASSO: 'Casso' };

function feedConfig(s: Stored): FeedConfig {
  const token = open(s.token, SEAL);
  if (!token) throw conflict('BANK_FEED_BAD_TOKEN', 'Mã API không đọc được — hãy nhập lại');
  return { provider: s.provider, token, sandbox: s.sandbox, accountNo: s.accountNo };
}

export async function saveConfig(
  userId: number,
  input: {
    provider: BankProvider;
    token?: string;
    sandbox: boolean;
    accountNo: string | null;
    enabled: boolean;
  },
) {
  const old = await load();
  let sealed: string;
  if (input.token) sealed = seal(input.token, SEAL);
  else if (old && old.provider === input.provider) sealed = old.token;
  else throw badRequest(`Nhập mã API của ${PROVIDER_NAME[input.provider]}`);
  // The VietQR account is the natural default: that is where customers transfer to.
  const accountNo = input.accountNo?.trim() || (await getSettings()).bank_account_no || null;
  const next: Stored = {
    provider: input.provider,
    token: sealed,
    sandbox: input.provider === 'SEPAY' && input.sandbox,
    accountNo,
    enabled: input.enabled,
    lastSyncAt: old?.lastSyncAt ?? null,
    lastOkAt: old?.lastOkAt ?? null,
    lastError: null,
  };
  if (input.enabled) {
    try {
      await testFeed(feedConfig(next));
    } catch (e) {
      if (e instanceof FeedAuthError)
        throw badRequest(`${PROVIDER_NAME[input.provider]} không nhận mã API này — kiểm tra lại mã`);
      throw badRequest((e as Error).message);
    }
  }
  await save(next);
  await writeAudit(prisma, {
    entity: 'bank_feed',
    entityId: input.provider,
    action: 'CONFIG',
    before: old ? { provider: old.provider, enabled: old.enabled, accountNo: old.accountNo } : null,
    after: {
      provider: next.provider,
      enabled: next.enabled,
      accountNo: next.accountNo,
      sandbox: next.sandbox,
    },
    userId,
  });
  if (next.enabled) kick();
  return toStatus(next);
}

export async function clear(userId: number) {
  const old = await load();
  if (old) {
    await save(null);
    await writeAudit(prisma, { entity: 'bank_feed', entityId: old.provider, action: 'CLEAR', userId });
  }
  return toStatus(null);
}

// ---------------------------------------------------------------- tills waiting for a transfer

const WAIT_MS = 3 * 60_000;
const waiting = new Map<number, { amount: string; until: number }>();

const activeWaits = () => {
  const now = Date.now();
  for (const [k, w] of waiting) if (w.until < now) waiting.delete(k);
  return [...waiting].map(([orderId, w]) => ({ orderId, amount: w.amount }));
};

/** Money tied to each order (ignored transactions are never tied). */
export async function receivedFor(db: Db, orderIds: number[]): Promise<Map<number, Prisma.Decimal>> {
  if (!orderIds.length) return new Map();
  const rows = await db.bankTransaction.groupBy({
    by: ['orderId'],
    where: { orderId: { in: orderIds }, ignoredAt: null },
    _sum: { amount: true },
  });
  return new Map(rows.map((r) => [r.orderId!, r._sum.amount!]));
}

/** A payment screen shows the QR of an order (amount null = closed): read the bank more often for a while. */
export async function watch(orderId: number, amount: string | null) {
  const enabled = await isEnabled();
  if (amount === null || !D(amount).gt(0)) waiting.delete(orderId);
  else if (enabled) {
    const fresh = !activeWaits().length;
    waiting.set(orderId, { amount: D(amount).toFixed(0), until: Date.now() + WAIT_MS });
    if (fresh) kick(500);
  }
  const received = (await receivedFor(prisma, [orderId])).get(orderId);
  return { enabled, received: received?.toString() ?? '0' };
}

// ---------------------------------------------------------------- reading the feed

let syncing: Promise<{ imported: number; matched: number }> | null = null;
let retryAfter = 0;

const addDays = (iso: string, n: number) =>
  fromDbDate(new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400_000));

/** Read new transactions and tie them to orders (one run at a time). */
export function sync() {
  syncing ??= runSync().finally(() => {
    syncing = null;
  });
  return syncing;
}

async function runSync(): Promise<{ imported: number; matched: number }> {
  const s = await load();
  if (!s?.enabled) return { imported: 0, matched: 0 };
  const now = new Date();
  const since = s.lastOkAt
    ? new Date(Math.max(Date.parse(s.lastOkAt) - 86400_000, now.getTime() - 3 * 86400_000))
    : new Date(now.getTime() - 86400_000);
  let fetched: FeedTxn[];
  try {
    const cfg = feedConfig(s);
    const known = new Set(
      (
        await prisma.bankTransaction.findMany({
          where: { provider: s.provider, transactedAt: { gte: new Date(since.getTime() - 86400_000) } },
          select: { externalId: true },
        })
      ).map((t) => t.externalId),
    );
    fetched = await fetchRecent(cfg, since, (id) => known.has(id));
  } catch (e) {
    const message =
      e instanceof FeedAuthError
        ? `${PROVIDER_NAME[s.provider]} từ chối mã API — nhập lại mã ở Cài đặt`
        : (e as Error).message;
    if (e instanceof FeedRateLimit) retryAfter = Date.now() + e.seconds * 1000;
    const latest = (await load()) ?? s;
    await save({ ...latest, lastSyncAt: now.toISOString(), lastError: message });
    throw badRequest(message);
  }
  const r = await importTxns(s.provider, fetched);
  const latest = (await load()) ?? s;
  await save({ ...latest, lastSyncAt: now.toISOString(), lastOkAt: now.toISOString(), lastError: null });
  return r;
}

async function importTxns(provider: BankProvider, fetched: FeedTxn[]) {
  if (!fetched.length) return { imported: 0, matched: 0 };
  const branchId = await defaultBranchId();
  const s = await getSettings();
  const waits = activeWaits();
  const openIds = new Set(
    (
      await prisma.order.findMany({
        where: { id: { in: waits.map((w) => w.orderId) }, status: 'OPEN' },
        select: { id: true },
      })
    ).map((o) => o.id),
  );
  const usable = waits.filter((w) => openIds.has(w.orderId));
  let imported = 0;
  let matched = 0;
  // Oldest first, so ids follow the order money arrived.
  for (const t of [...fetched].reverse()) {
    const at = Number.isNaN(t.transactedAt.getTime()) ? new Date() : t.transactedAt;
    const day = businessDateOf(at, s.business_day_start);
    const orders = await prisma.order.findMany({
      where: { branchId, businessDate: { gte: toDbDate(addDays(day, -2)), lte: toDbDate(addDays(day, 1)) } },
      select: { id: true, code: true },
    });
    const code = codeInDescription(
      t.description,
      orders.map((o) => o.code),
    );
    let orderId = code ? orders.find((o) => o.code === code)!.id : null;
    let kind: 'CODE' | 'AMOUNT' | null = orderId ? 'CODE' : null;
    if (!orderId) {
      orderId = orderByAmount(t.amount, usable);
      if (orderId) kind = 'AMOUNT';
    }
    try {
      await prisma.bankTransaction.create({
        data: {
          branchId,
          provider,
          externalId: t.externalId,
          accountNo: t.accountNo,
          amount: t.amount,
          description: t.description,
          reference: t.reference,
          bankName: t.bankName,
          transactedAt: at,
          businessDate: toDbDate(day),
          orderId,
          matchKind: kind,
          matchedAt: orderId ? new Date() : null,
        },
      });
    } catch (e) {
      // Read twice by two overlapping runs: already there.
      if ((e as { code?: string }).code === 'P2002') continue;
      throw e;
    }
    imported++;
    const orderCode = orderId ? (code ?? orders.find((o) => o.id === orderId)?.code ?? null) : null;
    if (orderId) {
      matched++;
      waiting.delete(orderId);
      emit(socketRooms.pos, 'order:update', { orderId });
    }
    emit(socketRooms.pos, 'bank:txn', { orderId, orderCode, amount: t.amount });
  }
  return { imported, matched };
}

// ---------------------------------------------------------------- lists & manual matching

const txnInclude = { order: { select: { code: true, status: true } } } as const;
type TxnRow = Prisma.BankTransactionGetPayload<{ include: typeof txnInclude }>;

async function names(db: Db, ids: (number | null)[]) {
  const wanted = [...new Set(ids.filter((x): x is number => x != null))];
  const rows = wanted.length
    ? await db.user.findMany({ where: { id: { in: wanted } }, select: { id: true, fullName: true } })
    : [];
  return new Map(rows.map((u) => [u.id, u.fullName]));
}

function toDto(t: TxnRow, who: Map<number, string>): BankTxnDto {
  return {
    id: t.id,
    provider: t.provider,
    amount: t.amount.toString(),
    description: t.description,
    reference: t.reference,
    bankName: t.bankName,
    accountNo: t.accountNo,
    transactedAt: t.transactedAt.toISOString(),
    businessDate: fromDbDate(t.businessDate),
    orderId: t.orderId,
    orderCode: t.order?.code ?? null,
    orderStatus: t.order?.status ?? null,
    matchKind: t.matchKind,
    matchedByName: t.matchedById ? (who.get(t.matchedById) ?? '') : null,
    ignored: !!t.ignoredAt,
    ignoreReason: t.ignoreReason,
    ignoredByName: t.ignoredById ? (who.get(t.ignoredById) ?? '') : null,
  };
}

const dtos = async (rows: TxnRow[]) => {
  const who = await names(
    prisma,
    rows.flatMap((r) => [r.matchedById, r.ignoredById]),
  );
  return rows.map((r) => toDto(r, who));
};

async function one(id: number) {
  const t = await prisma.bankTransaction.findUnique({ where: { id }, include: txnInclude });
  if (!t) throw notFound('Khoản tiền về');
  return (await dtos([t]))[0]!;
}

export async function list(from: string, to: string, filter: 'ALL' | 'UNMATCHED' | 'MATCHED' | 'IGNORED') {
  const rows = await prisma.bankTransaction.findMany({
    where: { branchId: await defaultBranchId(), businessDate: { gte: toDbDate(from), lte: toDbDate(to) } },
    include: txnInclude,
    orderBy: [{ transactedAt: 'desc' }, { id: 'desc' }],
  });
  const sumOf = (rs: TxnRow[]) => rs.reduce((acc, r) => acc.add(r.amount.toString()), ZERO).toString();
  const isMatched = (r: TxnRow) => r.orderId !== null;
  const isIgnored = (r: TxnRow) => !!r.ignoredAt;
  const shown = rows.filter((r) =>
    filter === 'MATCHED'
      ? isMatched(r)
      : filter === 'IGNORED'
        ? isIgnored(r)
        : filter === 'UNMATCHED'
          ? !isMatched(r) && !isIgnored(r)
          : true,
  );
  return {
    rows: await dtos(shown),
    totals: {
      received: sumOf(rows),
      matched: sumOf(rows.filter(isMatched)),
      unmatched: sumOf(rows.filter((r) => !isMatched(r) && !isIgnored(r))),
      ignored: sumOf(rows.filter(isIgnored)),
    },
  };
}

async function loadTxn(id: number): Promise<BankTransaction> {
  const t = await prisma.bankTransaction.findUnique({ where: { id } });
  if (!t) throw notFound('Khoản tiền về');
  return t;
}

export async function match(user: AuthUser, id: number, orderCode: string) {
  const t = await loadTxn(id);
  if (t.ignoredAt) throw badRequest('Khoản này đang được bỏ qua — bỏ đánh dấu trước');
  if (user.role !== 'ADMIN') {
    if (t.orderId) throw forbidden('Khoản này đã gán cho đơn khác — cần ADMIN đổi');
    if (fromDbDate(t.businessDate) !== (await businessToday()))
      throw forbidden('Nhân viên chỉ gán được tiền về trong ngày — các ngày trước cần ADMIN');
  }
  const order = await prisma.order.findFirst({
    where: { code: { equals: orderCode.trim(), mode: 'insensitive' } },
  });
  if (!order) throw badRequest(`Không có đơn ${orderCode}`);
  await prisma.$transaction(async (tx) => {
    await tx.bankTransaction.update({
      where: { id },
      data: { orderId: order.id, matchKind: 'MANUAL', matchedById: user.id, matchedAt: new Date() },
    });
    await writeAudit(tx, {
      entity: 'bank_transaction',
      entityId: id,
      action: 'MATCH',
      before: { orderId: t.orderId },
      after: { orderId: order.id, code: order.code },
      userId: user.id,
    });
  });
  emit(socketRooms.pos, 'order:update', { orderId: order.id });
  if (t.orderId) emit(socketRooms.pos, 'order:update', { orderId: t.orderId });
  return one(id);
}

export async function unmatch(user: AuthUser, id: number, reason: string) {
  const t = await loadTxn(id);
  if (!t.orderId) throw badRequest('Khoản này chưa gán cho đơn nào');
  await prisma.$transaction(async (tx) => {
    await tx.bankTransaction.update({
      where: { id },
      data: { orderId: null, matchKind: null, matchedById: null, matchedAt: null },
    });
    await writeAudit(tx, {
      entity: 'bank_transaction',
      entityId: id,
      action: 'UNMATCH',
      reason,
      before: { orderId: t.orderId, matchKind: t.matchKind },
      userId: user.id,
    });
  });
  emit(socketRooms.pos, 'order:update', { orderId: t.orderId });
  return one(id);
}

export async function ignore(user: AuthUser, id: number, reason: string) {
  const t = await loadTxn(id);
  if (t.orderId) throw badRequest('Khoản này đang gán cho một đơn — bỏ gán trước');
  await prisma.$transaction(async (tx) => {
    await tx.bankTransaction.update({
      where: { id },
      data: { ignoredAt: new Date(), ignoredById: user.id, ignoreReason: reason },
    });
    await writeAudit(tx, {
      entity: 'bank_transaction',
      entityId: id,
      action: 'IGNORE',
      reason,
      userId: user.id,
    });
  });
  return one(id);
}

export async function unignore(user: AuthUser, id: number) {
  await loadTxn(id);
  await prisma.$transaction(async (tx) => {
    await tx.bankTransaction.update({
      where: { id },
      data: { ignoredAt: null, ignoredById: null, ignoreReason: null },
    });
    await writeAudit(tx, { entity: 'bank_transaction', entityId: id, action: 'UNIGNORE', userId: user.id });
  });
  return one(id);
}

// ---------------------------------------------------------------- checks (day closing, alerts, reports)

/** Paid / cancelled orders of the range whose transfers and bank money disagree (or all, `all`). */
export async function transferOrders(from: string, to: string, all = false): Promise<TransferOrderDto[]> {
  const branchId = await defaultBranchId();
  const range = { gte: toDbDate(from), lte: toDbDate(to) };
  const orders = await prisma.order.findMany({
    where: {
      branchId,
      businessDate: range,
      status: { in: ['PAID', 'CANCELLED'] },
      OR: [
        { status: 'PAID', payments: { some: { method: 'TRANSFER' } } },
        { bankTransactions: { some: { ignoredAt: null } } },
      ],
    },
    include: { payments: { where: { method: 'TRANSFER' } } },
    orderBy: [{ businessDate: 'asc' }, { id: 'asc' }],
  });
  const received = await receivedFor(
    prisma,
    orders.map((o) => o.id),
  );
  return orders
    .map((o) => {
      const expected =
        o.status === 'PAID' ? o.payments.reduce((s, p) => s.add(p.amount.toString()), ZERO) : ZERO;
      const got = D(received.get(o.id)?.toString() ?? 0);
      return {
        orderId: o.id,
        code: o.code,
        businessDate: fromDbDate(o.businessDate),
        status: o.status,
        expected: expected.toString(),
        received: got.toString(),
        check: transferCheck(expected, got),
      };
    })
    .filter((o) => all || o.check !== 'OK');
}

async function unmatchedTxns(from: string, to: string) {
  const rows = await prisma.bankTransaction.findMany({
    where: {
      branchId: await defaultBranchId(),
      businessDate: { gte: toDbDate(from), lte: toDbDate(to) },
      orderId: null,
      ignoredAt: null,
    },
    include: txnInclude,
    orderBy: { transactedAt: 'asc' },
  });
  return dtos(rows);
}

/** Day closing: the day's transfers against the bank (null without a bank feed). */
export async function dayTransfer(date: string): Promise<DayTransfer> {
  if (!(await isEnabled())) return null;
  const orders = await transferOrders(date, date, true);
  const sum = transferSummary(orders.filter((o) => o.status === 'PAID'));
  return {
    expected: sum.expected.toString(),
    received: sum.received.toString(),
    short: sum.short,
    orders: orders.filter((o) => o.check !== 'OK'),
    unmatched: await unmatchedTxns(date, date),
  };
}

/** Bell / dashboard: problems of the last 30 days before today. */
export async function alerts() {
  const s = await load();
  if (!s?.enabled) return { unverifiedTransfers: 0, unmatchedTransfers: 0, bankFeedError: null };
  const today = await businessToday();
  const from = addDays(today, -30);
  const to = addDays(today, -1);
  const [orders, unmatched] = await Promise.all([
    transferOrders(from, to),
    prisma.bankTransaction.count({
      where: {
        branchId: await defaultBranchId(),
        businessDate: { gte: toDbDate(from), lte: toDbDate(to) },
        orderId: null,
        ignoredAt: null,
      },
    }),
  ]);
  return {
    unverifiedTransfers: orders.filter((o) => o.check === 'SHORT').length,
    unmatchedTransfers: unmatched,
    bankFeedError: s.lastError,
  };
}

/** Lines of the day-closing report on Telegram. */
export async function dailyLines(date: string): Promise<string[]> {
  const t = await dayTransfer(date);
  if (!t) return [];
  const lines: string[] = [];
  const shortOrders = t.orders.filter((o) => o.check === 'SHORT');
  if (shortOrders.length) {
    const missing = shortOrders.reduce((s, o) => s.add(D(o.expected).sub(o.received)), ZERO);
    lines.push(`⚠️ Chuyển khoản chưa thấy tiền về: ${shortOrders.length} đơn (${vnd(missing)})`);
  } else if (D(t.expected).gt(0)) lines.push(`Chuyển khoản: đã về đủ ${vnd(t.received)}`);
  if (t.unmatched.length) {
    const amount = t.unmatched.reduce((s, x) => s.add(x.amount), ZERO);
    lines.push(`Tiền về chưa rõ của đơn nào: ${t.unmatched.length} khoản (${vnd(amount)})`);
  }
  return lines;
}

/** Lines of the morning digest on Telegram. */
export async function morningLines(): Promise<string[]> {
  const a = await alerts();
  return [
    ...(a.unverifiedTransfers
      ? [`${a.unverifiedTransfers} đơn chuyển khoản các ngày trước chưa thấy tiền về`]
      : []),
    ...(a.unmatchedTransfers ? [`${a.unmatchedTransfers} khoản tiền về chưa gán vào đơn`] : []),
    ...(a.bankFeedError ? [`Đọc tiền chuyển khoản lỗi: ${a.bankFeedError}`] : []),
  ];
}

// ---------------------------------------------------------------- polling

let timer: NodeJS.Timeout | null = null;
let started = false;

/** Next reading: often while a till waits for a transfer, every minute otherwise. */
async function nextDelay() {
  const s = await load();
  const fast = activeWaits().length > 0;
  const base = !fast ? 60_000 : s?.provider === 'CASSO' ? 30_000 : 4_000;
  return Math.max(base, retryAfter - Date.now());
}

function schedule(ms: number) {
  if (!started) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(tick, ms);
  timer.unref();
}

async function tick() {
  try {
    if (await isEnabled()) await sync();
  } catch (e) {
    logger.warn({ err: (e as Error).message }, 'Đọc tiền chuyển khoản lỗi');
  } finally {
    schedule(await nextDelay().catch(() => 60_000));
  }
}

/** Read again soon (a till started waiting, the key was just saved). */
function kick(ms = 1000) {
  if (started && Date.now() >= retryAfter) schedule(ms);
}

export function startScheduler() {
  started = true;
  schedule(20_000);
}
