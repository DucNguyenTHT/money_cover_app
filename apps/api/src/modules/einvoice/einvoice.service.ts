// E-invoices (hoá đơn khởi tạo từ máy tính tiền) of paid orders. Paying queues the invoice inside the payment
// transaction; a worker sends it to the provider chosen in Settings and follows it until issued. No Internet: it
// waits and retries. Cancelling an issued sale queues a full decrease (hoá đơn điều chỉnh giảm). The provider
// secret is sealed in `settings` under KEY, outside the public settings schema.
import type { EInvoice, Prisma } from '@prisma/client';
import { prisma, type Tx } from '../../core/db';
import { badRequest, conflict, notFound } from '../../core/errors';
import { writeAudit } from '../../core/audit';
import { defaultBranchId } from '../../core/branch';
import { env } from '../../config/env';
import { logger } from '../../core/logger';
import { emit } from '../../core/realtime';
import { open, seal } from '../../core/secret-box';
import type { AuthUser } from '../../core/auth';
import { socketRooms } from '../../contracts/socket-events';
import type { BuyerDto, EInvoiceConfig, EInvoiceDto, OrderEInvoice } from '../../contracts/einvoice.contract';
import { fromDbDate, toDbDate } from '../../domain/business-date';
import { optionsLabel } from '../../domain/menu/options';
import { cleanBuyer, invoiceDocument, type InvoiceBuyer } from '../../domain/einvoice/document';
import type { EInvoiceProvider, EInvoiceStatus } from '../../domain/enums';
import { dmy, escapeHtml } from '../../domain/notify/messages';
import { getSettings } from '../settings/settings.service';
import * as notify from '../notify/notify.service';
import { PROVIDERS, RefusedError, RetryError, newReference, type ProviderConfig } from './providers';

const KEY = 'einvoice';
/** Retail customer who did not ask for an invoice in their name. */
const RETAIL: InvoiceBuyer = { name: null, taxCode: null, address: null, email: null };
const SEAL = 'einvoice-secret';

interface Stored {
  provider: EInvoiceProvider;
  enabled: boolean;
  mode: 'AUTO' | 'MANUAL';
  sandbox: boolean;
  clientId: string | null;
  clientSecret: string | null; // sealed
  providerAccountId: string | null;
  templateCode: string | null;
  invoiceSeries: string | null;
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

const toConfig = (s: Stored | null): EInvoiceConfig => ({
  provider: s?.provider ?? null,
  configured: !!s,
  enabled: !!s?.enabled,
  mode: s?.mode ?? 'AUTO',
  sandbox: !!s?.sandbox,
  clientId: s?.clientId ?? null,
  hasSecret: !!s?.clientSecret,
  providerAccountId: s?.providerAccountId ?? null,
  templateCode: s?.templateCode ?? null,
  invoiceSeries: s?.invoiceSeries ?? null,
  lastOkAt: s?.lastOkAt ?? null,
  lastError: s?.lastError ?? null,
});

export const config = async () => toConfig(await load());

export async function posInfo() {
  const s = await load();
  return { enabled: !!s?.enabled, mode: s?.mode ?? 'AUTO', provider: s?.provider ?? null };
}

function providerConfig(s: Pick<Stored, keyof ProviderConfig | 'clientSecret'>): ProviderConfig {
  const secret = s.clientSecret ? open(s.clientSecret, SEAL) : null;
  if (s.clientSecret && !secret)
    throw conflict('EINVOICE_BAD_SECRET', 'Client Secret không đọc được — hãy nhập lại');
  return {
    provider: s.provider,
    sandbox: s.sandbox,
    clientId: s.clientId,
    clientSecret: secret,
    providerAccountId: s.providerAccountId,
    templateCode: s.templateCode,
    invoiceSeries: s.invoiceSeries,
  };
}

interface Credentials {
  provider: EInvoiceProvider;
  sandbox: boolean;
  clientId?: string | null;
  clientSecret?: string;
}

/** Credentials typed now, the saved secret otherwise (same provider). */
async function credentialsOf(input: Credentials) {
  const old = await load();
  const sameProvider = old?.provider === input.provider;
  const clientSecret = input.clientSecret
    ? seal(input.clientSecret, SEAL)
    : sameProvider
      ? (old?.clientSecret ?? null)
      : null;
  const clientId = input.clientId?.trim() || (sameProvider ? (old?.clientId ?? null) : null);
  return { old, clientId, clientSecret };
}

const providerError = (e: unknown) =>
  e instanceof RefusedError || e instanceof RetryError ? badRequest(e.message) : e;

export async function accounts(input: Credentials) {
  const { clientId, clientSecret } = await credentialsOf(input);
  const cfg = providerConfig({
    provider: input.provider,
    sandbox: input.provider === 'SEPAY' && input.sandbox,
    clientId,
    clientSecret,
    providerAccountId: null,
    templateCode: null,
    invoiceSeries: null,
  });
  try {
    return await PROVIDERS[input.provider].accounts(cfg);
  } catch (e) {
    throw providerError(e);
  }
}

export async function saveConfig(
  userId: number,
  input: Credentials & {
    enabled: boolean;
    mode: 'AUTO' | 'MANUAL';
    providerAccountId: string | null;
    templateCode: string | null;
    invoiceSeries: string | null;
  },
) {
  const { old, clientId, clientSecret } = await credentialsOf(input);
  const mock = input.provider === 'MOCK';
  const next: Stored = {
    provider: input.provider,
    enabled: input.enabled,
    mode: input.mode,
    sandbox: input.provider === 'SEPAY' && input.sandbox,
    clientId: mock ? null : clientId,
    clientSecret: mock ? null : clientSecret,
    providerAccountId: mock ? 'mock' : input.providerAccountId?.trim() || null,
    templateCode: input.templateCode?.trim() || (mock ? '2' : null),
    invoiceSeries: input.invoiceSeries?.trim() || (mock ? 'C26MGL' : null),
    lastOkAt: old?.provider === input.provider ? (old?.lastOkAt ?? null) : null,
    lastError: null,
  };
  if (next.enabled && !mock) {
    if (!next.providerAccountId || !next.templateCode || !next.invoiceSeries)
      throw badRequest('Chọn tài khoản nhà cung cấp và mẫu / ký hiệu hoá đơn trước khi bật');
    let list;
    try {
      list = await PROVIDERS[next.provider].accounts(providerConfig(next));
    } catch (e) {
      throw providerError(e);
    }
    const acc = list.find((a) => a.id === next.providerAccountId);
    if (!acc)
      throw badRequest('Tài khoản nhà cung cấp không còn trong danh sách — bấm Lấy danh sách và chọn lại');
    if (
      acc.templates.length &&
      !acc.templates.some(
        (t) => t.templateCode === next.templateCode && t.invoiceSeries === next.invoiceSeries,
      )
    )
      throw badRequest('Mẫu / ký hiệu hoá đơn không có trong tài khoản này');
  }
  await save(next);
  await writeAudit(prisma, {
    entity: 'einvoice_config',
    entityId: next.provider,
    action: 'CONFIG',
    before: old ? { provider: old.provider, enabled: old.enabled, mode: old.mode } : null,
    after: {
      provider: next.provider,
      enabled: next.enabled,
      mode: next.mode,
      sandbox: next.sandbox,
      providerAccountId: next.providerAccountId,
      templateCode: next.templateCode,
      invoiceSeries: next.invoiceSeries,
    },
    userId,
  });
  if (next.enabled) kick();
  return toConfig(next);
}

export async function clear(userId: number) {
  const old = await load();
  if (old) {
    await save(null);
    await writeAudit(prisma, { entity: 'einvoice_config', entityId: old.provider, action: 'CLEAR', userId });
  }
  return toConfig(null);
}

// ---------------------------------------------------------------- invoices of orders

type Row = EInvoice & { order: { code: string } };

function toDto(r: Row): EInvoiceDto {
  return {
    id: r.id,
    orderId: r.orderId,
    orderCode: r.order.code,
    kind: r.kind,
    provider: r.provider,
    status: r.status,
    invoiceNo: r.invoiceNo,
    series: r.series,
    lookupUrl: r.lookupUrl,
    lookupCode: r.lookupCode,
    amount: r.amount.toString(),
    buyer: (r.buyer as BuyerDto | null) ?? null,
    attempts: r.attempts,
    lastError: r.lastError,
    issuedAt: r.issuedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

const withOrder = { order: { select: { code: true } } } as const;

async function one(id: number) {
  const r = await prisma.eInvoice.findUnique({ where: { id }, include: withOrder });
  if (!r) throw notFound('Hoá đơn điện tử');
  return toDto(r);
}

/** The invoice shown with an order (its rows, id order): the latest original, and its adjustment if cancelled. */
export function orderInvoice(rows: readonly EInvoice[]): OrderEInvoice | null {
  const r = rows.filter((x) => x.kind === 'ORIGINAL').at(-1);
  if (!r) return null;
  const adj = rows.filter((x) => x.kind === 'ADJUSTMENT' && x.originalId === r.id).at(-1);
  return {
    id: r.id,
    provider: r.provider,
    status: r.status,
    invoiceNo: r.invoiceNo,
    series: r.series,
    lookupUrl: r.lookupUrl,
    lookupCode: r.lookupCode,
    lastError: r.lastError,
    adjustment: adj?.status ?? null,
  };
}

/** Validate a buyer typed at the till (throws a clear 400). */
export function buyerOf(b: BuyerDto | null | undefined): InvoiceBuyer {
  const r = cleanBuyer(b);
  if ('error' in r) throw badRequest(`Thông tin người mua hoá đơn: ${r.error}`);
  return r;
}

/**
 * Inside the payment transaction: queue the invoice when e-invoices are on and wanted (automatic mode, or the
 * cashier asked). Returns the queued row, or null.
 */
export async function queueForPaymentTx(
  tx: Tx,
  orderId: number,
  wanted: boolean,
  buyer: InvoiceBuyer,
  userId: number,
): Promise<EInvoice | null> {
  const s = await load();
  if (!s?.enabled || (s.mode === 'MANUAL' && !wanted)) return null;
  return createOriginal(tx, s, orderId, buyer, userId);
}

async function createOriginal(
  tx: Tx,
  s: Stored,
  orderId: number,
  buyer: InvoiceBuyer,
  userId: number | null,
) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  if (order.status !== 'PAID') throw badRequest('Chỉ xuất hoá đơn cho đơn đã thanh toán');
  const active = await tx.eInvoice.findFirst({
    where: { orderId, kind: 'ORIGINAL', status: { in: ['PENDING', 'SENDING', 'ISSUED'] } },
  });
  if (active) return active;
  return tx.eInvoice.create({
    data: {
      branchId: order.branchId,
      orderId,
      kind: 'ORIGINAL',
      provider: s.provider,
      referenceCode: newReference(),
      amount: order.total,
      buyer: buyer.name ? (buyer as unknown as Prisma.InputJsonValue) : undefined,
      createdById: userId,
    },
  });
}

/** Inside the cancel transaction of a paid order: drop an invoice not sent yet, or queue a full decrease. */
export async function onOrderCancelledTx(tx: Tx, orderId: number, userId: number) {
  const orig = await tx.eInvoice.findFirst({
    where: { orderId, kind: 'ORIGINAL', status: { not: 'CANCELLED' } },
    orderBy: { id: 'desc' },
  });
  if (!orig) return;
  if (orig.status === 'PENDING' || orig.status === 'FAILED') {
    await tx.eInvoice.update({
      where: { id: orig.id },
      data: { status: 'CANCELLED', lastError: 'Đơn đã huỷ trước khi hoá đơn được phát hành' },
    });
    return;
  }
  const exists = await tx.eInvoice.findFirst({
    where: { originalId: orig.id, kind: 'ADJUSTMENT', status: { not: 'CANCELLED' } },
  });
  if (exists) return;
  await tx.eInvoice.create({
    data: {
      branchId: orig.branchId,
      orderId,
      kind: 'ADJUSTMENT',
      provider: orig.provider,
      referenceCode: newReference(),
      amount: orig.amount.negated(),
      originalId: orig.id,
      createdById: userId,
    },
  });
}

export async function issueForOrder(user: AuthUser, orderId: number, buyer: BuyerDto | undefined) {
  const s = await load();
  if (!s?.enabled) throw badRequest('Chưa bật hoá đơn điện tử (Cài đặt → Hoá đơn điện tử)');
  const b = buyerOf(buyer);
  const row = await prisma.$transaction(async (tx) => {
    const failed = await tx.eInvoice.findFirst({
      where: { orderId, kind: 'ORIGINAL', status: 'FAILED' },
      orderBy: { id: 'desc' },
    });
    // A refused invoice is sent again under a new reference, with the buyer typed now.
    if (failed) await tx.eInvoice.update({ where: { id: failed.id }, data: { status: 'CANCELLED' } });
    const r = await createOriginal(tx, s, orderId, b, user.id);
    await writeAudit(tx, {
      entity: 'einvoice',
      entityId: r.id,
      action: 'ISSUE',
      after: { orderId },
      userId: user.id,
    });
    return r;
  });
  await tryNow(row.id, 8000);
  emit(socketRooms.pos, 'order:update', { orderId });
  return one(row.id);
}

export async function retry(user: AuthUser, id: number) {
  const r = await prisma.eInvoice.findUnique({ where: { id } });
  if (!r) throw notFound('Hoá đơn điện tử');
  if (r.status !== 'FAILED' && r.status !== 'PENDING')
    throw badRequest('Chỉ gửi lại hoá đơn bị lỗi hoặc đang chờ');
  await prisma.$transaction(async (tx) => {
    await tx.eInvoice.update({
      where: { id },
      // A new reference: the provider refused the old one.
      data: {
        status: 'PENDING',
        nextAttemptAt: new Date(),
        lastError: null,
        ...(r.status === 'FAILED' ? { referenceCode: newReference(), attempts: 0 } : {}),
      },
    });
    await writeAudit(tx, { entity: 'einvoice', entityId: id, action: 'RETRY', userId: user.id });
  });
  await tryNow(id, 8000);
  emit(socketRooms.pos, 'order:update', { orderId: r.orderId });
  return one(id);
}

export async function list(from: string, to: string, status?: EInvoiceStatus) {
  const branchId = await defaultBranchId();
  const range = { gte: toDbDate(from), lte: toDbDate(to) };
  const rows = await prisma.eInvoice.findMany({
    where: { branchId, order: { businessDate: range } },
    include: withOrder,
    orderBy: { id: 'desc' },
  });
  const counts = { PENDING: 0, SENDING: 0, ISSUED: 0, FAILED: 0, CANCELLED: 0 } as Record<
    EInvoiceStatus,
    number
  >;
  for (const r of rows) counts[r.status]++;
  return { rows: rows.filter((r) => !status || r.status === status).map(toDto), counts };
}

// ---------------------------------------------------------------- sending

/** Wait before the next try: quick while the provider works on it, longer after failures. */
const backoff = (attempts: number) => [60, 300, 900, 3600][Math.min(attempts, 3)]! * 1000;
const checkDelay = (attempts: number) => [3, 5, 10, 30, 60][Math.min(attempts, 4)]! * 1000;
/** Not issued within 3 days: given up, the owner is told. */
const GIVE_UP_MS = 3 * 86400_000;

async function documentOf(orderId: number, buyer: InvoiceBuyer) {
  const o = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      items: { where: { status: 'ACTIVE' }, include: { dish: true, options: true }, orderBy: { id: 'asc' } },
      payments: true,
    },
  });
  const s = await getSettings();
  return invoiceDocument(
    {
      code: o.code,
      businessDate: fromDbDate(o.businessDate),
      netRevenue: o.netRevenue.toString(),
      vatPct: o.vatPct.toString(),
      vatMode: o.vatMode,
      vatAmount: o.vatAmount.toString(),
      total: o.total.toString(),
      items: o.items.map((i) => ({
        name: i.options.length ? `${i.dish.name} (${optionsLabel(i.options)})` : i.dish.name,
        qty: i.qty,
        unitPrice: i.unitPrice.toString(),
        amount: i.amount.toString(),
        netAmount: i.netAmount.toString(),
      })),
      payments: o.payments.map((p) => ({ method: p.method, amount: p.amount.toString() })),
    },
    s.tax_regime,
    buyer,
  );
}

const busy = new Set<number>();

async function failed(r: EInvoice, message: string) {
  await prisma.eInvoice.update({ where: { id: r.id }, data: { status: 'FAILED', lastError: message } });
  const order = await prisma.order.findUnique({
    where: { id: r.orderId },
    select: { code: true, businessDate: true },
  });
  await notify.enqueue(
    prisma,
    'ALERT',
    `⚠️ <b>Hoá đơn điện tử ${r.kind === 'ADJUSTMENT' ? 'điều chỉnh ' : ''}không phát hành được</b> · đơn ${order?.code ?? r.orderId}${
      order ? ` ngày ${dmy(fromDbDate(order.businessDate))}` : ''
    }\n${escapeHtml(message)}\nXem: Kế toán → Hoá đơn điện tử`,
  );
  emit(socketRooms.pos, 'order:update', { orderId: r.orderId });
}

/** One step for one invoice: send it, or ask the provider how it went. */
async function step(r: EInvoice, s: Stored): Promise<void> {
  const provider = PROVIDERS[r.provider];
  const cfg = providerConfig(r.provider === s.provider ? s : { ...s, provider: r.provider });
  const now = Date.now();
  if (now - r.createdAt.getTime() > GIVE_UP_MS && r.status !== 'ISSUED')
    return failed(
      r,
      r.lastError ? `Quá 3 ngày chưa phát hành được: ${r.lastError}` : 'Quá 3 ngày chưa phát hành được',
    );
  try {
    let result: {
      status: 'ISSUED' | 'SENDING' | 'FAILED';
      trackingCode?: string | null;
      invoiceNo?: string | null;
      series?: string | null;
      lookupUrl?: string | null;
      lookupCode?: string | null;
      error?: string | null;
    };
    if (r.status === 'SENDING' && r.trackingCode) {
      result = await provider.check(cfg, r.trackingCode, r.kind);
    } else if (r.kind === 'ADJUSTMENT') {
      const orig = r.originalId ? await prisma.eInvoice.findUnique({ where: { id: r.originalId } }) : null;
      if (!orig || orig.status === 'FAILED' || orig.status === 'CANCELLED') {
        await prisma.eInvoice.update({
          where: { id: r.id },
          data: { status: 'CANCELLED', lastError: 'Hoá đơn gốc chưa phát hành — không cần điều chỉnh' },
        });
        return;
      }
      if (orig.status !== 'ISSUED') {
        await prisma.eInvoice.update({
          where: { id: r.id },
          data: { nextAttemptAt: new Date(now + 60_000) },
        });
        return;
      }
      const doc = await documentOf(r.orderId, (orig.buyer as InvoiceBuyer | null) ?? RETAIL);
      result = await provider.cancelByAdjustment(
        cfg,
        { referenceCode: orig.referenceCode, invoiceNo: orig.invoiceNo },
        doc,
        r.referenceCode,
      );
    } else {
      const doc = await documentOf(r.orderId, (r.buyer as InvoiceBuyer | null) ?? RETAIL);
      try {
        result = await provider.issue(cfg, doc, r.referenceCode);
      } catch (e) {
        // Sent before, answer lost: the provider already has this reference.
        if (!(e instanceof RefusedError && /EXISTED/.test(e.message))) throw e;
        result = await provider.lookup(cfg, r.referenceCode);
      }
    }
    // Just accepted: ask once at once (often already done).
    if (result.status === 'SENDING' && result.trackingCode && r.status === 'PENDING') {
      const first = await provider.check(cfg, result.trackingCode, r.kind).catch(() => null);
      if (first && first.status !== 'SENDING') result = { ...result, ...first };
    }
    if (result.status === 'FAILED') return failed(r, result.error ?? 'Nhà cung cấp từ chối hoá đơn');
    if (result.status === 'ISSUED') {
      await prisma.eInvoice.update({
        where: { id: r.id },
        data: {
          status: 'ISSUED',
          issuedAt: new Date(),
          invoiceNo: result.invoiceNo ?? r.invoiceNo,
          series: result.series ?? r.series ?? s.invoiceSeries,
          lookupUrl: result.lookupUrl ?? r.lookupUrl,
          lookupCode: result.lookupCode ?? r.lookupCode,
          attempts: { increment: 1 },
          lastError: null,
        },
      });
      emit(socketRooms.pos, 'order:update', { orderId: r.orderId });
      return;
    }
    await prisma.eInvoice.update({
      where: { id: r.id },
      data: {
        status: 'SENDING',
        trackingCode: result.trackingCode ?? r.trackingCode,
        series: result.series ?? r.series,
        attempts: { increment: 1 },
        nextAttemptAt: new Date(now + checkDelay(r.attempts)),
        lastError: null,
      },
    });
  } catch (e) {
    if (e instanceof RefusedError) return failed(r, e.message);
    const message = e instanceof RetryError ? e.message : `Lỗi khi gửi hoá đơn: ${(e as Error).message}`;
    if (!(e instanceof RetryError)) logger.error(e, 'Hoá đơn điện tử lỗi');
    await prisma.eInvoice.update({
      where: { id: r.id },
      data: {
        attempts: { increment: 1 },
        lastError: message,
        nextAttemptAt: new Date(now + backoff(r.attempts)),
      },
    });
  }
}

async function runOne(id: number, s: Stored) {
  if (busy.has(id)) return;
  busy.add(id);
  try {
    const r = await prisma.eInvoice.findUnique({ where: { id } });
    if (r && (r.status === 'PENDING' || r.status === 'SENDING')) await step(r, s);
  } finally {
    busy.delete(id);
  }
}

let processing: Promise<{ done: number; waiting: number }> | null = null;

/** Send / follow every invoice that is due (one run at a time). */
export function processDue() {
  processing ??= (async () => {
    const s = await load();
    if (!s?.enabled) return { done: 0, waiting: 0 };
    const due = await prisma.eInvoice.findMany({
      where: { status: { in: ['PENDING', 'SENDING'] }, nextAttemptAt: { lte: new Date() } },
      orderBy: { id: 'asc' },
      take: 50,
    });
    for (const r of due) await runOne(r.id, s);
    const waiting = await prisma.eInvoice.count({ where: { status: { in: ['PENDING', 'SENDING'] } } });
    const ok = await prisma.eInvoice.count({ where: { id: { in: due.map((d) => d.id) }, status: 'ISSUED' } });
    const latest = (await load()) ?? s;
    const lastErr = await prisma.eInvoice.findFirst({
      where: {
        id: { in: due.map((d) => d.id) },
        lastError: { not: null },
        status: { in: ['PENDING', 'SENDING', 'FAILED'] },
      },
      orderBy: { id: 'desc' },
    });
    await save({
      ...latest,
      ...(ok ? { lastOkAt: new Date().toISOString() } : {}),
      lastError: due.length ? (lastErr?.lastError ?? null) : latest.lastError,
    });
    return { done: ok, waiting };
  })().finally(() => {
    processing = null;
  });
  return processing;
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

/** Right after paying: try to have the invoice issued before the bill prints (gives up after `ms`). */
export async function tryNow(id: number, ms: number) {
  const s = await load();
  if (!s?.enabled) return;
  const until = Date.now() + ms;
  for (;;) {
    await runOne(id, s);
    const r = await prisma.eInvoice.findUnique({ where: { id } });
    if (!r || r.status !== 'SENDING' || Date.now() > until) return;
    await sleep(Math.min(1000, Math.max(0, r.nextAttemptAt.getTime() - Date.now())));
    await prisma.eInvoice.update({ where: { id }, data: { nextAttemptAt: new Date() } });
  }
}

// ---------------------------------------------------------------- alerts & report lines

export async function alerts() {
  const s = await load();
  if (!s?.enabled) return { einvoiceFailed: 0, einvoiceStuck: 0 };
  const branchId = await defaultBranchId();
  const [failedCount, stuck] = await Promise.all([
    prisma.eInvoice.count({
      where: { branchId, status: 'FAILED', createdAt: { gte: new Date(Date.now() - 30 * 86400_000) } },
    }),
    prisma.eInvoice.count({
      where: {
        branchId,
        status: { in: ['PENDING', 'SENDING'] },
        createdAt: { lt: new Date(Date.now() - 3600_000) },
      },
    }),
  ]);
  return { einvoiceFailed: failedCount, einvoiceStuck: stuck };
}

/** Lines of the day-closing report on Telegram. */
export async function dailyLines(date: string): Promise<string[]> {
  const s = await load();
  if (!s?.enabled) return [];
  const rows = await prisma.eInvoice.groupBy({
    by: ['status'],
    where: { kind: 'ORIGINAL', order: { businessDate: toDbDate(date) } },
    _count: { _all: true },
  });
  const n = (st: EInvoiceStatus) => rows.find((r) => r.status === st)?._count._all ?? 0;
  const waiting = n('PENDING') + n('SENDING');
  const parts = [`Hoá đơn điện tử: đã phát hành ${n('ISSUED')}`];
  if (waiting) parts.push(`đang chờ ${waiting}`);
  if (n('FAILED')) parts.push(`⚠️ lỗi ${n('FAILED')}`);
  return [parts.join(' · ')];
}

/** Lines of the morning digest on Telegram. */
export async function morningLines(): Promise<string[]> {
  const a = await alerts();
  return [
    ...(a.einvoiceFailed
      ? [`${a.einvoiceFailed} hoá đơn điện tử bị từ chối — gửi lại ở Kế toán → Hoá đơn điện tử`]
      : []),
    ...(a.einvoiceStuck ? [`${a.einvoiceStuck} hoá đơn điện tử chờ quá 1 giờ chưa phát hành`] : []),
  ];
}

/** Paid orders of a day without an invoice while e-invoices are on (manual mode: the cashier skipped it). */
export async function ordersWithoutInvoice(date: string) {
  const s = await load();
  if (!s?.enabled) return 0;
  return prisma.order.count({
    where: {
      businessDate: toDbDate(date),
      status: 'PAID',
      einvoices: { none: { kind: 'ORIGINAL', status: { in: ['PENDING', 'SENDING', 'ISSUED'] } } },
    },
  });
}

// ---------------------------------------------------------------- worker

let timer: NodeJS.Timeout | null = null;
let started = false;

function schedule(ms: number) {
  if (!started) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      await processDue();
    } catch (e) {
      logger.error(e, 'Gửi hoá đơn điện tử lỗi');
    } finally {
      schedule(30_000);
    }
  }, ms);
  timer.unref();
}

/** Send soon (a new invoice was queued). */
export function kick(ms = 1000) {
  if (env.NODE_ENV !== 'test') schedule(ms);
}

export function startScheduler() {
  started = true;
  schedule(15_000);
}
