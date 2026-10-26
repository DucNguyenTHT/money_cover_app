import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Banknote, CheckCircle2, CreditCard, Landmark, Plus, Smartphone, Trash2 } from 'lucide-react';
import type { OrderDto } from '@ketoan/api/contracts';
import { cashSuggestions, vietQrConfigured, vietQrPayload, type PaymentMethod } from '@ketoan/api/domain';
import { Dialog } from '@/components/ui/Dialog';
import { Button, IconButton, Spinner } from '@/components/ui/Button';
import { client, errorMessage, HttpError, ok } from '@/lib/api-client';
import { money } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useToast } from '@/components/ui/Toast';
import { FormError } from '@/auth/AuthCard';
import { posKeys, usePosSettings } from './data';
import { useQueryClient } from '@tanstack/react-query';
import { BuyerFields, emptyBuyer, useEInvoicePos } from '@/components/EInvoiceParts';
import { billHtml, printHtml } from './print';

const METHODS: { value: PaymentMethod; label: string; icon: typeof Banknote }[] = [
  { value: 'CASH', label: 'Tiền mặt', icon: Banknote },
  { value: 'TRANSFER', label: 'Chuyển khoản', icon: Landmark },
  { value: 'CARD', label: 'Thẻ', icon: CreditCard },
  { value: 'APP', label: 'App', icon: Smartphone },
];

interface Line {
  method: PaymentMethod;
  amount: string;
  cashReceived: string;
}

const digits = (v: string) => v.replace(/\D/g, '');
const fmtInput = (v: string) => (v === '' ? '' : money(Number(v)));

export function PaymentDialog({
  order,
  open,
  onClose,
  onPaid,
}: {
  order: OrderDto;
  open: boolean;
  onClose: () => void;
  onPaid: (o: OrderDto) => void;
}) {
  const total = Number(order.total);
  const settings = usePosSettings().data?.settings;
  const toast = useToast();
  const [lines, setLines] = useState<Line[]>([]);
  const [printBill, setPrintBill] = useState(true);
  const [belowCost, setBelowCost] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [qrSvg, setQrSvg] = useState('');
  const einv = useEInvoicePos().data;
  const qc = useQueryClient();
  const [points, setPoints] = useState('');
  const [pointsBusy, setPointsBusy] = useState(false);
  const [invoiceWanted, setInvoiceWanted] = useState(false);
  const [companyInvoice, setCompanyInvoice] = useState(false);
  const [buyer, setBuyer] = useState(emptyBuyer);

  useEffect(() => {
    if (!open) return;
    // Money already on the bank account for this order (the customer scanned the printed bill): start from it.
    const got = Math.min(Number(order.transferReceived), total);
    setLines(
      order.channel === 'APP'
        ? [{ method: 'APP', amount: String(total), cashReceived: '' }]
        : got >= total
          ? [{ method: 'TRANSFER', amount: String(total), cashReceived: '' }]
          : got > 0
            ? [
                { method: 'TRANSFER', amount: String(got), cashReceived: '' },
                { method: 'CASH', amount: String(total - got), cashReceived: '' },
              ]
            : [{ method: 'CASH', amount: String(total), cashReceived: '' }],
    );
    setBelowCost(null);
    setError(null);
    setInvoiceWanted(false);
    setCompanyInvoice(false);
    setBuyer(emptyBuyer);
    // Only when the dialog opens (not each time money arrives while it is open).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order.id, order.channel, total]);

  const paid = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const left = total - paid;
  const cash = lines.find((l) => l.method === 'CASH');
  const change = cash && cash.cashReceived ? Number(cash.cashReceived) - Number(cash.amount || 0) : 0;
  const transfer = lines.find((l) => l.method === 'TRANSFER');

  const qrPayload = useMemo(() => {
    if (
      !transfer ||
      !settings ||
      !vietQrConfigured(settings.bank_bin, settings.bank_account_no) ||
      !Number(transfer.amount)
    )
      return null;
    return vietQrPayload({
      bin: settings.bank_bin,
      accountNo: settings.bank_account_no,
      amount: Number(transfer.amount),
      purpose: order.code,
    });
  }, [transfer, settings, order.code]);

  useEffect(() => {
    if (!qrPayload) return setQrSvg('');
    QRCode.toString(qrPayload, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then(setQrSvg, () =>
      setQrSvg(''),
    );
  }, [qrPayload]);

  // Bank feed: while the QR is shown, the server reads the bank more often and pushes the order when money
  // arrives (order.transferReceived then grows).
  const [feed, setFeed] = useState(false);
  const transferAmount = transfer && Number(transfer.amount) > 0 ? transfer.amount : null;
  useEffect(() => {
    if (!open || !transferAmount) return;
    let alive = true;
    const ping = () =>
      client.bank
        .watch({ body: { orderId: order.id, amount: transferAmount } })
        .then((r) => alive && r.status === 200 && setFeed(r.body.enabled))
        .catch(() => undefined);
    void ping();
    const t = setInterval(ping, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
      client.bank.watch({ body: { orderId: order.id, amount: null } }).catch(() => undefined);
    };
  }, [open, order.id, transferAmount]);
  const received = Number(order.transferReceived);
  const arrived = feed && !!transferAmount && received >= Number(transferAmount);
  const announced = useRef(false);
  useEffect(() => {
    if (!open) announced.current = false;
    else if (arrived && !announced.current) {
      announced.current = true;
      toast(`Đã nhận ${money(received)} ₫ chuyển khoản — bấm Xác nhận thanh toán`);
    }
  }, [open, arrived, received, toast]);

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  const pickMethod = (m: PaymentMethod) => {
    if (lines.length === 1) setLines([{ method: m, amount: String(total), cashReceived: '' }]);
    else if (!lines.some((l) => l.method === m))
      setLines((ls) => [...ls, { method: m, amount: String(Math.max(0, left)), cashReceived: '' }]);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = ok(
        await client.orders.pay({
          params: { id: order.id },
          body: {
            version: order.version,
            print: printBill && settings?.print_mode === 'SERVER',
            belowCostReason: belowCost?.trim() || undefined,
            ...(einv?.enabled
              ? {
                  einvoice: {
                    issue: einv.mode === 'AUTO' || invoiceWanted,
                    ...(companyInvoice ? { buyer } : {}),
                  },
                }
              : {}),
            payments: lines
              .filter((l) => Number(l.amount) > 0)
              .map((l) => ({
                method: l.method,
                amount: l.amount,
                cashReceived: l.method === 'CASH' && l.cashReceived ? l.cashReceived : null,
              })),
          },
        }),
      );
      if (res.printWarnings.length) toast(`Máy in: ${res.printWarnings[0]}`, 'bad');
      if (printBill && !res.printed) {
        const bill = ok(await client.orders.bill({ params: { id: order.id } }));
        printHtml(await billHtml(bill, false));
      }
      toast(`Đã thanh toán ${order.code}${change > 0 ? ` · tiền thối ${money(change)}` : ''}`);
      onPaid(res.order);
    } catch (e) {
      if (e instanceof HttpError && e.code === 'BELOW_COST') {
        setBelowCost('');
        setError(e.message);
      } else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const canPay =
    left === 0 &&
    lines.every(
      (l) => l.method !== 'CASH' || !l.cashReceived || Number(l.cashReceived) >= Number(l.amount),
    ) &&
    (belowCost === null || belowCost.trim().length >= 5);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Thanh toán · ${order.code}`}
      width={760}
      footer={
        <>
          <label className="mr-auto flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={printBill}
              onChange={(e) => setPrintBill(e.target.checked)}
              className="size-4 accent-primary"
            />
            In hoá đơn
          </label>
          <Button onClick={onClose}>Đóng</Button>
          <Button variant="pay" size="lg" loading={busy} disabled={!canPay} onClick={submit} kbd="Enter">
            Xác nhận thanh toán
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canPay && !busy) submit();
        }}
        className="grid grid-cols-[minmax(0,1fr)] gap-5 md:grid-cols-[minmax(0,1fr)_260px]"
      >
        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid grid-cols-2 gap-2">
            {METHODS.map((m) => {
              const on = lines.some((l) => l.method === m.value);
              return (
                <button
                  key={m.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => pickMethod(m.value)}
                  className={cn(
                    'flex h-12 items-center justify-center gap-2 rounded-ctl border text-sm font-semibold',
                    on
                      ? 'border-primary bg-primary-soft text-primary-ink'
                      : 'border-field bg-white text-ink hover:bg-page',
                  )}
                >
                  <m.icon size={18} /> {m.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-2">
            {lines.map((l, i) => (
              <div
                key={l.method}
                className="flex flex-wrap items-end gap-2 rounded-ctl border border-line-soft bg-page p-2.5"
              >
                <span className="w-24 pb-2.5 text-[13px] font-semibold">
                  {METHODS.find((m) => m.value === l.method)!.label}
                </span>
                <label className="flex min-w-[120px] flex-1 flex-col gap-1 text-xs text-muted">
                  Số tiền
                  <input
                    inputMode="numeric"
                    value={fmtInput(l.amount)}
                    onChange={(e) => setLine(i, { amount: digits(e.target.value) })}
                    className="num h-10 rounded-ctl border border-field bg-white px-3 text-right text-[15px] font-semibold text-ink"
                  />
                </label>
                {l.method === 'CASH' && (
                  <label className="flex min-w-[120px] flex-1 flex-col gap-1 text-xs text-muted">
                    Khách đưa
                    <input
                      inputMode="numeric"
                      value={fmtInput(l.cashReceived)}
                      placeholder={money(l.amount)}
                      onChange={(e) => setLine(i, { cashReceived: digits(e.target.value) })}
                      className="num h-10 rounded-ctl border border-field bg-white px-3 text-right text-[15px] font-semibold text-ink"
                    />
                  </label>
                )}
                {lines.length > 1 && (
                  <IconButton
                    label="Bỏ hình thức này"
                    type="button"
                    onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))}
                  >
                    <Trash2 size={18} />
                  </IconButton>
                )}
              </div>
            ))}
            {cash && (
              <div className="flex flex-wrap gap-2">
                {cashSuggestions(cash.amount || 0).map((v) => (
                  <button
                    key={v.toString()}
                    type="button"
                    onClick={() => setLine(lines.indexOf(cash), { cashReceived: v.toString() })}
                    className="num h-10 rounded-ctl border border-field bg-white px-3 text-sm font-semibold hover:bg-page"
                  >
                    {money(v.toString())}
                  </button>
                ))}
              </div>
            )}
            {lines.length < 4 && left > 0 && (
              <p className="flex items-center gap-1.5 text-[13px] text-warn">
                <Plus size={14} /> Còn thiếu {money(left)} — chọn thêm hình thức hoặc sửa số tiền
              </p>
            )}
            {left < 0 && (
              <p className="text-[13px] text-bad">Tổng các hình thức vượt số cần trả {money(-left)}</p>
            )}
          </div>

          {belowCost !== null && (
            <label className="flex flex-col gap-1.5 text-[13px] font-medium text-warn">
              Lý do bán dưới giá vốn (bắt buộc)
              <textarea
                autoFocus
                rows={2}
                value={belowCost}
                onChange={(e) => setBelowCost(e.target.value)}
                className="rounded-ctl border border-field px-3 py-2 text-sm font-normal text-ink"
              />
            </label>
          )}
          {einv?.enabled && (
            <div className="flex flex-col gap-2 rounded-ctl border border-line-soft p-3 text-[13px]">
              {einv.mode === 'AUTO' ? (
                <span className="text-muted">
                  Hoá đơn điện tử tự xuất khi thanh toán{einv.provider === 'MOCK' ? ' (giả lập)' : ''}.
                </span>
              ) : (
                <label className="flex items-center gap-2 font-medium">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={invoiceWanted}
                    onChange={(e) => setInvoiceWanted(e.target.checked)}
                  />
                  Xuất hoá đơn điện tử{einv.provider === 'MOCK' ? ' (giả lập)' : ''}
                </label>
              )}
              {(einv.mode === 'AUTO' || invoiceWanted) && (
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={companyInvoice}
                    onChange={(e) => setCompanyInvoice(e.target.checked)}
                  />
                  Khách lấy hoá đơn có tên / mã số thuế
                </label>
              )}
              {companyInvoice && (einv.mode === 'AUTO' || invoiceWanted) && (
                <BuyerFields value={buyer} onChange={setBuyer} />
              )}
            </div>
          )}
          {order.customer && settings?.loyalty_enabled && (
            <div className="flex flex-wrap items-end gap-2 rounded-ctl border border-line-soft p-3 text-[13px]">
              <span className="flex-1">
                <b>{order.customer.name}</b> có <b className="num">{money(order.customer.points)}</b> điểm
                {order.pointsRedeemed > 0 && (
                  <span className="block text-good">
                    Đang dùng {order.pointsRedeemed} điểm = −{money(order.pointsDiscount)} ₫
                  </span>
                )}
              </span>
              <label className="flex w-28 flex-col gap-1 text-xs text-muted">
                Dùng điểm
                <input
                  inputMode="numeric"
                  value={points}
                  placeholder={order.pointsRedeemed ? String(order.pointsRedeemed) : '0'}
                  onChange={(e) => setPoints(e.target.value.replace(/\D/g, ''))}
                  className="num h-9 rounded-ctl border border-field bg-white px-2 text-right text-sm text-ink"
                />
              </label>
              <Button
                size="sm"
                loading={pointsBusy}
                disabled={points === '' && !order.pointsRedeemed}
                onClick={async () => {
                  setPointsBusy(true);
                  setError(null);
                  try {
                    const o = ok(
                      await client.orders.redeemPoints({
                        params: { id: order.id },
                        body: { version: order.version, points: points === '' ? 0 : Number(points) },
                      }),
                    );
                    qc.setQueryData(posKeys.order(o.id), o);
                    setPoints('');
                  } catch (e) {
                    setError(errorMessage(e));
                  } finally {
                    setPointsBusy(false);
                  }
                }}
              >
                {points === '' && order.pointsRedeemed ? 'Bỏ dùng điểm' : 'Áp dụng'}
              </Button>
            </div>
          )}
          <FormError message={error} />
          <button type="submit" hidden />
        </div>

        <aside className="flex flex-col gap-2 rounded-card bg-page p-4 text-[13px]">
          <Row label="Tổng tiền hàng" value={order.subtotal} />
          {Number(order.promoDiscountTotal) > 0 && (
            <Row label="Khuyến mãi" value={String(-Number(order.promoDiscountTotal))} />
          )}
          {Number(order.itemDiscountTotal) + Number(order.orderDiscountAmount) > 0 && (
            <Row
              label="Giảm giá"
              value={String(-(Number(order.itemDiscountTotal) + Number(order.orderDiscountAmount)))}
            />
          )}
          {Number(order.pointsDiscount) > 0 && (
            <Row label={`Đổi ${order.pointsRedeemed} điểm`} value={String(-Number(order.pointsDiscount))} />
          )}
          {Number(order.serviceChargeAmount) > 0 && (
            <Row label={`Phụ thu ${Number(order.serviceChargePct)}%`} value={order.serviceChargeAmount} />
          )}
          {Number(order.vatAmount) > 0 && (
            <Row
              label={`${order.vatMode === 'INCLUSIVE' ? 'Đã gồm VAT' : 'VAT'} ${Number(order.vatPct)}%`}
              value={order.vatAmount}
            />
          )}
          <div className="mt-1 flex items-baseline justify-between border-t border-line pt-2">
            <span className="font-semibold">Khách cần trả</span>
            <span className="num text-[24px] font-bold text-primary-ink">{money(total)}</span>
          </div>
          {change > 0 && (
            <div className="flex items-baseline justify-between">
              <span className="font-semibold">Tiền thối</span>
              <span className="num text-xl font-bold text-pay">{money(change)}</span>
            </div>
          )}
          {transfer && (
            <div className="mt-2 flex flex-col items-center gap-1 rounded-ctl bg-white p-3 text-center">
              {qrSvg ? (
                <>
                  <div className="size-44 [&_svg]:size-full" dangerouslySetInnerHTML={{ __html: qrSvg }} />
                  <span className="num font-semibold">{money(transfer.amount)} ₫</span>
                  <span className="text-xs text-muted">Nội dung: {order.code}</span>
                  {feed && (
                    <span
                      role="status"
                      className={cn(
                        'mt-1 flex w-full items-center justify-center gap-1.5 rounded-ctl px-2 py-1.5 text-xs font-semibold',
                        arrived
                          ? 'bg-good-soft text-good'
                          : received > 0
                            ? 'bg-warn-soft text-warn'
                            : 'bg-page text-muted',
                      )}
                    >
                      {arrived ? (
                        <>
                          <CheckCircle2 size={14} /> Đã nhận {money(received)} ₫
                        </>
                      ) : received > 0 ? (
                        `Đã nhận ${money(received)} ₫, còn thiếu ${money(Number(transfer.amount) - received)} ₫`
                      ) : (
                        <>
                          <Spinner className="size-3" /> Đang chờ tiền về…
                        </>
                      )}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-xs text-muted">
                  Chưa cài tài khoản ngân hàng (Cài đặt → VietQR) nên chưa có mã QR.
                </span>
              )}
            </div>
          )}
        </aside>
      </form>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-muted">
      <span>{label}</span>
      <span className="num">{money(value)}</span>
    </div>
  );
}
