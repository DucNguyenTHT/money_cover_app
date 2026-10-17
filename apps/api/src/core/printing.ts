// Raw ESC/POS printing to LAN thermal printers (port 9100).
// Bills / kitchen tickets are rendered in step 5; this module owns the transport and a test page.
import { Socket } from 'node:net';
import { AppError } from './errors';

const ESC = 0x1b;
const GS = 0x1d;

export const escpos = {
  init: Buffer.from([ESC, 0x40]),
  alignCenter: Buffer.from([ESC, 0x61, 1]),
  alignLeft: Buffer.from([ESC, 0x61, 0]),
  boldOn: Buffer.from([ESC, 0x45, 1]),
  boldOff: Buffer.from([ESC, 0x45, 0]),
  doubleOn: Buffer.from([GS, 0x21, 0x11]),
  doubleOff: Buffer.from([GS, 0x21, 0x00]),
  feed: (n = 1) => Buffer.from([ESC, 0x64, n]),
  cut: Buffer.from([GS, 0x56, 0x42, 0x00]),
  /** ASCII text; Vietnamese diacritics are stripped because most printers lack a Vietnamese code page. */
  text: (s: string) =>
    Buffer.from(s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D') + '\n', 'ascii'),
};

/** Send bytes to a printer; rejects with a readable error when it cannot be reached. */
export function sendToPrinter(ip: string, port: number, data: Buffer, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    const fail = (why: string) => {
      socket.destroy();
      reject(new AppError(400, 'PRINTER_UNREACHABLE', `Không kết nối được máy in ${ip}:${port} (${why})`));
    };
    socket.setTimeout(timeoutMs, () => fail('hết thời gian chờ'));
    socket.once('error', (e) => fail(e.message));
    socket.connect(port, ip, () => {
      socket.end(data, () => resolve());
    });
  });
}

export function testPage(name: string, paperWidth: number): Buffer {
  const line = '-'.repeat(paperWidth === 58 ? 32 : 48);
  return Buffer.concat([
    escpos.init,
    escpos.alignCenter,
    escpos.doubleOn,
    escpos.text('IN THU'),
    escpos.doubleOff,
    escpos.text(name),
    escpos.text(line),
    escpos.alignLeft,
    escpos.text(`Kho giay: ${paperWidth}mm`),
    escpos.text(`Thoi gian: ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`),
    escpos.text('May in hoat dong binh thuong.'),
    escpos.feed(4),
    escpos.cut,
  ]);
}
