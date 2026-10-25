// E-invoice providers. Each one issues the provider-independent InvoiceDocument (domain/einvoice/document.ts).
// MOCK issues fake invoices locally (to try the whole flow, never sent to the tax authority); SEPAY uses the SePay
// eInvoice API (asynchronous: create → poll the tracking code). Adding a provider = one more object here.
import { randomUUID } from 'node:crypto';
import type { EInvoiceProvider as ProviderName } from '../../domain/enums';
import type { InvoiceDocument } from '../../domain/einvoice/document';

export interface ProviderConfig {
  provider: ProviderName;
  sandbox: boolean;
  clientId: string | null;
  clientSecret: string | null;
  providerAccountId: string | null;
  templateCode: string | null;
  invoiceSeries: string | null;
}

export interface Issued {
  /** ISSUED: done; SENDING: accepted, ask again with `trackingCode`. */
  status: 'ISSUED' | 'SENDING';
  trackingCode?: string | null;
  invoiceNo?: string | null;
  series?: string | null;
  lookupUrl?: string | null;
  lookupCode?: string | null;
}

export interface Checked {
  status: 'ISSUED' | 'SENDING' | 'FAILED';
  invoiceNo?: string | null;
  lookupUrl?: string | null;
  error?: string | null;
}

export interface ProviderAccount {
  id: string;
  provider: string;
  active: boolean;
  templates: { templateCode: string; invoiceSeries: string; label: string }[];
}

/** The provider looked at the request and refused it: sending it again unchanged will not help. */
export class RefusedError extends Error {}
/** No answer / a hiccup on their side: try again later. */
export class RetryError extends Error {}

export interface Provider {
  issue(cfg: ProviderConfig, doc: InvoiceDocument, referenceCode: string): Promise<Issued>;
  /** Full decrease of an issued invoice (the sale was cancelled). */
  cancelByAdjustment(
    cfg: ProviderConfig,
    original: { referenceCode: string; invoiceNo: string | null },
    doc: InvoiceDocument,
    referenceCode: string,
  ): Promise<Issued>;
  check(cfg: ProviderConfig, trackingCode: string, kind: 'ORIGINAL' | 'ADJUSTMENT'): Promise<Checked>;
  /** The invoice sent with our reference (a request that went through but whose answer was lost). */
  lookup(cfg: ProviderConfig, referenceCode: string): Promise<Checked>;
  accounts(cfg: ProviderConfig): Promise<ProviderAccount[]>;
}

// ---------------------------------------------------------------- MOCK

const mock: Provider = {
  async issue(_cfg, _doc, ref) {
    return {
      status: 'ISSUED',
      invoiceNo: `GL${ref.replace(/-/g, '').slice(0, 7).toUpperCase()}`,
      series: 'GIẢ LẬP',
      lookupCode: ref.replace(/-/g, '').slice(-8).toUpperCase(),
      lookupUrl: null,
    };
  },
  async cancelByAdjustment(_cfg, _original, _doc, ref) {
    return {
      status: 'ISSUED',
      invoiceNo: `GL${ref.replace(/-/g, '').slice(0, 7).toUpperCase()}`,
      series: 'GIẢ LẬP',
    };
  },
  async check() {
    return { status: 'ISSUED' };
  },
  async lookup() {
    return { status: 'ISSUED' };
  },
  async accounts() {
    return [
      {
        id: 'mock',
        provider: 'giả lập',
        active: true,
        templates: [
          { templateCode: '2', invoiceSeries: 'C26MGL', label: '2 - C26MGL - Hoá đơn bán hàng (giả lập)' },
        ],
      },
    ];
  },
};

// ---------------------------------------------------------------- SePay eInvoice

const sepayBase = (cfg: ProviderConfig) =>
  cfg.sandbox ? 'https://einvoice-api-sandbox.sepay.vn' : 'https://einvoice-api.sepay.vn';

/** Access tokens last 24 h: kept in memory, asked again when refused. */
const tokens = new Map<string, { token: string; until: number }>();

/** Errors on SePay's side that a retry will not fix (quota used up, registration not approved…). */
const FINAL_CODES =
  /QUOTA|REGISTRATION|BILLING|NOT_TAX_APPROVED|BEFORE_TAX_APPROVAL|EXISTED|VALIDATION|NOT_FOUND/;

async function sepayCall<T>(
  cfg: ProviderConfig,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  const key = `${cfg.sandbox}:${cfg.clientId}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    let tok = tokens.get(key);
    if (!tok || tok.until < Date.now()) {
      tok = await sepayToken(cfg);
      tokens.set(key, tok);
    }
    let res: Response;
    try {
      res = await fetch(`${sepayBase(cfg)}${path}`, {
        method,
        headers: { authorization: `Bearer ${tok.token}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new RetryError('Không kết nối được SePay — kiểm tra Internet của máy chủ');
    }
    if (res.status === 401 && attempt === 0) {
      tokens.delete(key);
      continue;
    }
    const json = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      data?: T;
      message?: string;
      error?: string | { code?: string; message?: string };
      error_code?: string;
      code?: string;
    };
    if (res.ok && json.success !== false) return json.data as T;
    const code =
      json.error_code ?? json.code ?? (typeof json.error === 'object' ? json.error?.code : json.error) ?? '';
    const text = (typeof json.error === 'object' ? json.error?.message : undefined) ?? json.message ?? '';
    const msg = `SePay báo lỗi ${res.status}${code ? ` ${code}` : ''}${text ? `: ${text}` : ''}`;
    if (res.status === 401)
      throw new RefusedError('SePay không nhận Client ID / Client Secret — kiểm tra lại');
    if (res.status >= 500 && !FINAL_CODES.test(String(code))) throw new RetryError(msg);
    if (res.status === 429) throw new RetryError(msg);
    throw new RefusedError(msg);
  }
  throw new RefusedError('SePay không nhận Client ID / Client Secret — kiểm tra lại');
}

async function sepayToken(cfg: ProviderConfig) {
  if (!cfg.clientId || !cfg.clientSecret)
    throw new RefusedError('Chưa nhập Client ID / Client Secret của SePay');
  let res: Response;
  try {
    res = await fetch(`${sepayBase(cfg)}/v1/token`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}`,
      },
    });
  } catch {
    throw new RetryError('Không kết nối được SePay — kiểm tra Internet của máy chủ');
  }
  const json = (await res.json().catch(() => ({}))) as {
    data?: { access_token?: string; expires_in?: number };
  };
  if (!res.ok || !json.data?.access_token) {
    if (res.status >= 500) throw new RetryError(`SePay báo lỗi ${res.status}`);
    throw new RefusedError('SePay không nhận Client ID / Client Secret — kiểm tra lại');
  }
  // Renew a little early.
  return {
    token: json.data.access_token,
    until: Date.now() + ((json.data.expires_in ?? 86400) - 300) * 1000,
  };
}

const shopNow = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 19).replace('T', ' ');

function sepayItems(doc: InvoiceDocument, sign = 1) {
  return doc.lines.map((l, k) => ({
    line_number: k + 1,
    line_type: 1,
    item_name: l.name,
    unit: l.unit,
    quantity: l.qty,
    unit_price: sign * Number(l.unitPrice),
    before_discount_and_tax_amount: sign * Number(l.gross),
    discount_amount: sign * Number(l.discount),
    ...(l.taxRate ? { tax_rate: Number(l.taxRate), tax_amount: sign * Number(l.tax) } : {}),
  }));
}

function sepayBuyer(doc: InvoiceDocument) {
  const b = doc.buyer;
  if (!b.name) return { name: 'Người mua không lấy hoá đơn' };
  return {
    name: b.name,
    legal_name: b.name,
    ...(b.taxCode ? { tax_code: b.taxCode } : {}),
    ...(b.address ? { address: b.address } : {}),
    ...(b.email ? { email: b.email } : {}),
  };
}

function needAccount(cfg: ProviderConfig) {
  if (!cfg.providerAccountId || !cfg.templateCode || !cfg.invoiceSeries)
    throw new RefusedError('Chưa chọn tài khoản nhà cung cấp / mẫu hoá đơn / ký hiệu trong Cài đặt');
}

const sepay: Provider = {
  async issue(cfg, doc, ref) {
    needAccount(cfg);
    const r = await sepayCall<{ tracking_code: string }>(cfg, 'POST', '/v1/invoices/create', {
      template_code: cfg.templateCode,
      invoice_series: cfg.invoiceSeries,
      issued_date: shopNow(),
      currency: 'VND',
      provider_account_id: cfg.providerAccountId,
      reference_code: ref,
      payment_method: doc.paymentMethod,
      is_draft: false,
      notes: `Đơn ${doc.orderCode}`,
      buyer: sepayBuyer(doc),
      items: sepayItems(doc),
      total_amount: Number(doc.total),
    });
    return { status: 'SENDING', trackingCode: r.tracking_code, series: cfg.invoiceSeries };
  },
  async cancelByAdjustment(cfg, original, doc, ref) {
    needAccount(cfg);
    const r = await sepayCall<{ tracking_code: string }>(cfg, 'POST', '/v1/invoices/adjust', {
      provider_account_id: cfg.providerAccountId,
      original_invoice_reference_code: original.referenceCode,
      adjustment_type: 'decrease',
      is_draft: false,
      reference_code: ref,
      notes: `Huỷ đơn ${doc.orderCode} — điều chỉnh giảm toàn bộ hoá đơn${original.invoiceNo ? ` số ${original.invoiceNo}` : ''}`,
      items: sepayItems(doc, -1),
    });
    return { status: 'SENDING', trackingCode: r.tracking_code, series: cfg.invoiceSeries };
  },
  async check(cfg, trackingCode, kind) {
    const r = await sepayCall<{
      status: string;
      message?: string;
      invoice?: { invoice_number?: string | null; pdf_url?: string | null; status?: string };
    }>(
      cfg,
      'GET',
      `/v1/invoices/${kind === 'ADJUSTMENT' ? 'adjust' : 'create'}/check/${encodeURIComponent(trackingCode)}`,
    );
    const s = (r.status ?? '').toLowerCase();
    if (s === 'success')
      return {
        status: 'ISSUED',
        invoiceNo: r.invoice?.invoice_number ?? null,
        lookupUrl: r.invoice?.pdf_url ?? null,
      };
    if (s === 'failed') return { status: 'FAILED', error: r.message ?? 'SePay báo xuất hoá đơn thất bại' };
    return { status: 'SENDING' };
  },
  async lookup(cfg, ref) {
    const r = await sepayCall<{ status?: string; invoice_number?: string | null; pdf_url?: string | null }>(
      cfg,
      'GET',
      `/v1/invoices/${encodeURIComponent(ref)}`,
    );
    if ((r.status ?? '').toLowerCase() === 'issued')
      return { status: 'ISSUED', invoiceNo: r.invoice_number ?? null, lookupUrl: r.pdf_url ?? null };
    return { status: 'SENDING' };
  },
  async accounts(cfg) {
    const list = await sepayCall<{ id: string; provider: string; active: boolean }[]>(
      cfg,
      'GET',
      '/v1/provider-accounts',
    );
    const out: ProviderAccount[] = [];
    for (const a of list ?? []) {
      const d = await sepayCall<{
        id: string;
        provider: string;
        active: boolean;
        templates?: { template_code: string; invoice_series: string; invoice_label?: string }[];
      }>(cfg, 'GET', `/v1/provider-accounts/${encodeURIComponent(a.id)}`);
      out.push({
        id: d.id,
        provider: d.provider,
        active: d.active,
        templates: (d.templates ?? []).map((t) => ({
          templateCode: t.template_code,
          invoiceSeries: t.invoice_series,
          label: t.invoice_label ?? `${t.template_code} - ${t.invoice_series}`,
        })),
      });
    }
    return out;
  },
};

export const PROVIDERS: Record<ProviderName, Provider> = { MOCK: mock, SEPAY: sepay };

/** Our own id of an invoice request, sent to the provider so a retried request is never issued twice. */
export const newReference = () => randomUUID();
