// Browser printing (fallback when no LAN printer is set up): an 80 mm page printed from a hidden iframe.
import QRCode from 'qrcode';
import type { BillDto, OrderDto, OrderItemDto } from '@ketoan/api/contracts';
import { money } from '@/lib/format';
import { whereLabel } from './data';
import { optionsLabel } from '@ketoan/api/domain';

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const time = (iso: string) =>
  new Date(iso).toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

const PAGE_CSS = `
  @page { size: 80mm auto; margin: 3mm; }
  * { box-sizing: border-box; }
  body { margin: 0; width: 74mm; font: 12px/1.4 Inter, Arial, sans-serif; color: #000; }
  h1 { font-size: 15px; margin: 0; text-align: center; }
  .c { text-align: center; } .r { text-align: right; } .b { font-weight: 700; } .s { font-size: 11px; }
  .row { display: flex; justify-content: space-between; gap: 8px; }
  hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
  .big { font-size: 16px; font-weight: 700; }
  .qr { display: flex; justify-content: center; margin: 6px 0 2px; } .qr svg { width: 38mm; height: 38mm; }
  .item { margin-bottom: 3px; }
  .k { font-size: 16px; font-weight: 700; margin: 4px 0 0; } .note { margin-left: 12px; font-style: italic; }
`;

export async function billHtml(b: BillDto, provisional: boolean): Promise<string> {
  const o = b.order;
  const active = o.items.filter((i) => i.status === 'ACTIVE');
  const discount = Number(o.itemDiscountTotal) + Number(o.orderDiscountAmount);
  const showQr =
    b.qr && Number(o.total) > 0 && (provisional || o.payments.some((p) => p.method === 'TRANSFER'));
  const qr = showQr
    ? await QRCode.toString(b.qr!, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' })
    : '';
  const method = { CASH: 'Tiền mặt', TRANSFER: 'Chuyển khoản', CARD: 'Thẻ', APP: 'App' } as const;
  const inv =
    !provisional && o.einvoice && ['ISSUED', 'PENDING', 'SENDING'].includes(o.einvoice.status)
      ? o.einvoice
      : null;
  const invQr =
    inv?.status === 'ISSUED' && inv.lookupUrl
      ? await QRCode.toString(inv.lookupUrl, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' })
      : '';
  const invoiceBlock = inv
    ? `<hr><div class="c b">HOÁ ĐƠN ĐIỆN TỬ${inv.provider === 'MOCK' ? ' (GIẢ LẬP)' : ''}</div>${
        inv.status === 'ISSUED'
          ? `<div class="c s">Số ${esc(inv.invoiceNo ?? '—')}${inv.series ? ` · Ký hiệu ${esc(inv.series)}` : ''}</div>${
              inv.lookupCode ? `<div class="c s">Mã tra cứu: ${esc(inv.lookupCode)}</div>` : ''
            }${invQr ? `<div class="c s">Quét mã để xem hoá đơn</div><div class="qr">${invQr}</div>` : ''}${
              inv.provider === 'MOCK' ? '<div class="c s">Bản thử — không có giá trị</div>' : ''
            }`
          : '<div class="c s">Đang phát hành — in lại bill để xem số</div>'
      }`
    : '';
  return `
    <h1>${esc(b.branch.name)}</h1>
    ${b.branch.address ? `<div class="c s">${esc(b.branch.address)}</div>` : ''}
    ${b.branch.phone ? `<div class="c s">ĐT: ${esc(b.branch.phone)}</div>` : ''}
    <hr><div class="c b">${provisional ? 'PHIẾU TẠM TÍNH' : 'HOÁ ĐƠN THANH TOÁN'}</div>
    <div class="c s">${esc(o.code)} · ${esc(whereLabel(o))} · ${time(o.paidAt ?? new Date().toISOString())}</div><hr>
    ${active
      .map(
        (
          i,
        ) => `<div class="item"><div>${esc(i.dishName)}${i.note ? ` <span class="s">(${esc(i.note)})</span>` : ''}</div>
        ${i.options.length ? `<div class="s">  ${esc(optionsLabel(i.options))}</div>` : ''}
        <div class="row s"><span>${i.qty} × ${money(i.unitPrice)}</span><span>${money(i.amount)}</span></div>
        ${Number(i.discountAmount) > 0 ? `<div class="row s"><span>Giảm giá</span><span>−${money(i.discountAmount)}</span></div>` : ''}</div>`,
      )
      .join('')}
    <hr><div class="row"><span>Tổng tiền hàng</span><span>${money(o.subtotal)}</span></div>
    ${discount > 0 ? `<div class="row"><span>Giảm giá${o.discountReason ? ` (${esc(o.discountReason)})` : ''}</span><span>−${money(discount)}</span></div>` : ''}
    ${Number(o.serviceChargeAmount) > 0 ? `<div class="row"><span>Phụ thu ${Number(o.serviceChargePct)}%</span><span>${money(o.serviceChargeAmount)}</span></div>` : ''}
    ${Number(o.vatAmount) > 0 ? `<div class="row"><span>${o.vatMode === 'INCLUSIVE' ? 'Đã gồm' : ''} VAT ${Number(o.vatPct)}%</span><span>${money(o.vatAmount)}</span></div>` : ''}
    <div class="row big"><span>TỔNG</span><span>${money(o.total)}</span></div>
    ${o.payments
      .map(
        (p) => `<div class="row"><span>${method[p.method]}</span><span>${money(p.amount)}</span></div>
        ${p.method === 'CASH' && p.cashReceived ? `<div class="row s"><span>Khách đưa / tiền thối</span><span>${money(p.cashReceived)} / ${money(p.change)}</span></div>` : ''}`,
      )
      .join('')}
    ${invoiceBlock}
    ${qr ? `<hr><div class="c s">Quét mã để chuyển khoản</div><div class="qr">${qr}</div><div class="c s">${esc(b.bankAccount ?? '')}</div>` : ''}
    <hr><div class="c s">${esc(b.footer)}</div>`;
}

export function kitchenHtml(o: OrderDto, items: OrderItemDto[], stationLabel: string): string {
  return `
    <div class="c b">${esc(stationLabel)}</div>
    <h1>${esc(whereLabel(o))}</h1>
    <div class="c s">${esc(o.code)} · ${time(new Date().toISOString())}</div><hr>
    ${items.map((i) => `<div class="k">${i.qty} × ${esc(i.dishName)}</div>${i.options.length ? `<div class="note">+ ${esc(optionsLabel(i.options))}</div>` : ''}${i.note ? `<div class="note">* ${esc(i.note)}</div>` : ''}`).join('')}
    ${o.note ? `<hr><div>Ghi chú: ${esc(o.note)}</div>` : ''}`;
}

/** Print an HTML fragment on an 80 mm page from a hidden iframe. */
export function printHtml(body: string) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, {
    position: 'fixed',
    right: '0',
    bottom: '0',
    width: '0',
    height: '0',
    border: '0',
  });
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(
    `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>In</title><style>${PAGE_CSS}</style></head><body>${body}</body></html>`,
  );
  doc.close();
  const go = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 1000);
  };
  if (doc.readyState === 'complete') setTimeout(go, 50);
  else frame.onload = go;
}
