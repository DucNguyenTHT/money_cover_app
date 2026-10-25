// Bills and kitchen tickets rendered as ESC/POS and sent to the LAN printers of each station.
import type { PrinterRole } from '@prisma/client';
import { prisma } from '../../core/db';
import { escpos, sendToPrinter } from '../../core/printing';
import { emit } from '../../core/realtime';
import { logger } from '../../core/logger';
import { socketRooms } from '../../contracts/socket-events';
import type { BillDto, OrderDto, OrderItemDto } from '../../contracts/orders.contract';
import type { Station } from '../../domain/enums';
import { optionsLabel } from '../../domain/menu/options';

const GS = 0x1d;
const vnd = (v: string | number) => Math.round(Number(v)).toLocaleString('vi-VN');
const time = (iso: string | Date) =>
  new Date(iso).toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
  });

const widthOf = (paperWidth: number) => (paperWidth === 58 ? 32 : 48);
const ascii = (s: string) => escpos.text(s).toString('ascii').replace(/\n$/, '');

/** "left ....... right" on one line (left is cut when too long). */
function cols(left: string, right: string, width: number) {
  const r = ascii(right);
  const l = ascii(left).slice(0, Math.max(1, width - r.length - 1));
  return l + ' '.repeat(Math.max(1, width - l.length - r.length)) + r;
}

/** Native QR (GS ( k), size 6, error level M. */
function qr(data: string): Buffer {
  const bytes = Buffer.from(data, 'ascii');
  const len = bytes.length + 3;
  return Buffer.concat([
    Buffer.from([GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]),
    Buffer.from([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06]),
    Buffer.from([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31]),
    Buffer.from([GS, 0x28, 0x6b, len & 0xff, len >> 8, 0x31, 0x50, 0x30]),
    bytes,
    Buffer.from([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]),
  ]);
}

export const whereOf = (
  o: Pick<OrderDto, 'channel' | 'tableName' | 'deliveryAppName' | 'appOrderCode' | 'code'>,
) =>
  o.channel === 'DINE_IN'
    ? (o.tableName ?? 'Tại bàn')
    : o.channel === 'APP'
      ? `${o.deliveryAppName ?? 'App'}${o.appOrderCode ? ` #${o.appOrderCode}` : ''}`
      : `Mang về #${o.code.slice(-3)}`;

export function kitchenTicket(
  o: OrderDto,
  items: OrderItemDto[],
  station: Station,
  paperWidth: number,
  reprint = false,
): Buffer {
  const w = widthOf(paperWidth);
  const parts: Buffer[] = [
    escpos.init,
    escpos.alignCenter,
    escpos.boldOn,
    escpos.text(`${station === 'BAR' ? 'PHIEU BAR' : 'PHIEU BEP'}${reprint ? ' (IN LAI)' : ''}`),
    escpos.doubleOn,
    escpos.text(whereOf(o)),
    escpos.doubleOff,
    escpos.boldOff,
    escpos.text(`${o.code} - ${time(new Date())}`),
    escpos.alignLeft,
    escpos.text('-'.repeat(w)),
  ];
  for (const it of items) {
    parts.push(escpos.doubleOn, escpos.text(`${it.qty} x ${it.dishName}`), escpos.doubleOff);
    // Size / toppings / requests: what the cook must do differently.
    if (it.options.length)
      parts.push(escpos.boldOn, escpos.text(`   + ${optionsLabel(it.options)}`), escpos.boldOff);
    if (it.note) parts.push(escpos.text(`   * ${it.note}`));
  }
  if (o.note) parts.push(escpos.text('-'.repeat(w)), escpos.text(`Ghi chu: ${o.note}`));
  parts.push(escpos.feed(4), escpos.cut);
  return Buffer.concat(parts);
}

export function billTicket(b: BillDto, paperWidth: number, provisional: boolean): Buffer {
  const o = b.order;
  const w = widthOf(paperWidth);
  const line = escpos.text('-'.repeat(w));
  const row = (l: string, r: string) => escpos.text(cols(l, r, w));
  const parts: Buffer[] = [
    escpos.init,
    escpos.alignCenter,
    escpos.boldOn,
    escpos.text(b.branch.name),
    escpos.boldOff,
    ...(b.branch.address ? [escpos.text(b.branch.address)] : []),
    ...(b.branch.phone ? [escpos.text(`DT: ${b.branch.phone}`)] : []),
    escpos.feed(1),
    escpos.boldOn,
    escpos.text(provisional ? 'PHIEU TAM TINH' : 'HOA DON THANH TOAN'),
    escpos.boldOff,
    escpos.text(`${o.code} - ${whereOf(o)}`),
    escpos.text(time(o.paidAt ?? new Date().toISOString())),
    escpos.alignLeft,
    line,
  ];
  for (const it of o.items.filter((i) => i.status === 'ACTIVE')) {
    parts.push(escpos.text(it.dishName));
    if (it.options.length) parts.push(escpos.text(`  (${optionsLabel(it.options)})`));
    parts.push(row(`  ${it.qty} x ${vnd(it.unitPrice)}`, vnd(it.amount)));
    if (Number(it.discountAmount) > 0) parts.push(row('  Giam gia', `-${vnd(it.discountAmount)}`));
  }
  parts.push(line, row('Tong tien hang', vnd(o.subtotal)));
  const disc = Number(o.itemDiscountTotal) + Number(o.orderDiscountAmount);
  if (disc > 0) parts.push(row('Giam gia', `-${vnd(disc)}`));
  if (Number(o.pointsDiscount) > 0)
    parts.push(row(`Doi ${o.pointsRedeemed} diem`, `-${vnd(o.pointsDiscount)}`));
  if (Number(o.serviceChargeAmount) > 0)
    parts.push(row(`Phu thu ${Number(o.serviceChargePct)}%`, vnd(o.serviceChargeAmount)));
  if (Number(o.vatAmount) > 0) {
    parts.push(
      row(
        o.vatMode === 'INCLUSIVE' ? `Gom VAT ${Number(o.vatPct)}%` : `VAT ${Number(o.vatPct)}%`,
        vnd(o.vatAmount),
      ),
    );
  }
  parts.push(
    escpos.boldOn,
    escpos.doubleOn,
    escpos.text(cols('TONG', vnd(o.total), w / 2)),
    escpos.doubleOff,
    escpos.boldOff,
  );
  for (const p of o.payments) {
    const label = { CASH: 'Tien mat', TRANSFER: 'Chuyen khoan', CARD: 'The', APP: 'App' }[p.method];
    parts.push(row(label, vnd(p.amount)));
    if (p.method === 'CASH' && p.cashReceived)
      parts.push(row('  Khach dua', vnd(p.cashReceived)), row('  Tien thoi', vnd(p.change ?? 0)));
  }
  if (o.customer && !provisional)
    parts.push(
      escpos.text(`Khach: ${o.customer.name}`),
      ...(o.pointsEarned
        ? [escpos.text(`Tich them ${o.pointsEarned} diem - con ${o.customer.points} diem`)]
        : []),
    );
  // E-invoice (hoá đơn khởi tạo từ máy tính tiền): number and where the customer looks it up.
  const inv = o.einvoice;
  if (
    !provisional &&
    inv &&
    (inv.status === 'ISSUED' || inv.status === 'PENDING' || inv.status === 'SENDING')
  ) {
    parts.push(line, escpos.alignCenter, escpos.boldOn);
    parts.push(
      escpos.text(inv.provider === 'MOCK' ? 'HOA DON DIEN TU (GIA LAP)' : 'HOA DON DIEN TU'),
      escpos.boldOff,
    );
    if (inv.status === 'ISSUED') {
      if (inv.invoiceNo || inv.series)
        parts.push(escpos.text(`So ${inv.invoiceNo ?? '-'}${inv.series ? ` - Ky hieu ${inv.series}` : ''}`));
      if (inv.lookupCode) parts.push(escpos.text(`Ma tra cuu: ${inv.lookupCode}`));
      if (inv.lookupUrl) parts.push(escpos.text('Quet ma de xem hoa don'), qr(inv.lookupUrl));
      if (inv.provider === 'MOCK') parts.push(escpos.text('Ban thu - khong co gia tri'));
    } else parts.push(escpos.text('Dang phat hanh - in lai bill de xem so'));
    parts.push(escpos.alignLeft);
  }
  if (b.qr && Number(o.total) > 0 && (provisional || o.payments.some((p) => p.method === 'TRANSFER'))) {
    parts.push(
      escpos.alignCenter,
      escpos.feed(1),
      escpos.text('Quet ma de chuyen khoan'),
      qr(b.qr),
      escpos.text(b.bankAccount ?? ''),
    );
  }
  parts.push(escpos.alignCenter, escpos.feed(1), escpos.text(b.footer), escpos.feed(4), escpos.cut);
  return Buffer.concat(parts);
}

/**
 * Send to every active printer of `role`. Never throws: problems come back as warnings
 * (and a printer:error event) so selling is never blocked by a printer.
 */
export async function printTo(
  role: PrinterRole,
  render: (paperWidth: number) => Buffer,
): Promise<{ printed: boolean; warnings: string[] }> {
  const printers = await prisma.printer.findMany({ where: { role, active: true } });
  if (!printers.length) return { printed: false, warnings: [] };
  const warnings: string[] = [];
  let printed = false;
  for (const p of printers) {
    try {
      await sendToPrinter(p.ip, p.port, render(p.paperWidth));
      printed = true;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logger.warn({ printer: p.name, message }, 'print failed');
      warnings.push(`${p.name}: ${message}`);
      emit(socketRooms.pos, 'printer:error', { printerName: p.name, message });
    }
  }
  return { printed, warnings };
}
