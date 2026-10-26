import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { Printer, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { FormError } from '@/auth/AuthCard';
import { useToast } from '@/components/ui/Toast';
import { client, errorMessage, ok } from '@/lib/api-client';
import { printHtml } from '@/pos/print';

const SHEET_CSS = `
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; font-family: Inter, system-ui, sans-serif; }
  body { margin: 0; color: #101828; }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8mm; }
  .card { border: 1px dashed #98a2b3; border-radius: 4mm; padding: 6mm; text-align: center; break-inside: avoid; }
  .shop { font-size: 11pt; color: #475467; }
  .table { font-size: 22pt; font-weight: 700; margin: 1mm 0 3mm; }
  .qr svg { width: 58mm; height: 58mm; }
  .hint { font-size: 11pt; margin-top: 2mm; }
  .url { font-size: 7pt; color: #98a2b3; word-break: break-all; margin-top: 1mm; }
`;
const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Where the QR points: the setting, or this server's guest site (port 8081; the dev server serves it itself). */
export function guestBaseUrl(setting: string) {
  if (setting) return setting.replace(/\/$/, '');
  return import.meta.env.DEV ? location.origin : `http://${location.hostname}:8081`;
}

/** QR codes of the tables: print a sheet to stick on the tables, renew one table's code. */
export function TableQrDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const settings = useQuery({ queryKey: ['settings'], queryFn: async () => ok(await client.settings.get()) });
  const s = settings.data?.settings;
  const base = guestBaseUrl(s?.qr_base_url ?? '');
  const [renew, setRenew] = useState<number | null>(null);
  const codes = useMutation({
    mutationFn: async (renewTableId: number | null) =>
      ok(await client.tableRequests.qrCodes({ body: { renewTableId } })),
  });
  const [svgs, setSvgs] = useState<Record<number, string>>({});
  useEffect(() => codes.mutate(null), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const list = codes.data ?? [];
    Promise.all(
      list.map(
        async (c) =>
          [c.tableId, await QRCode.toString(`${base}/t/${c.token}`, { type: 'svg', margin: 1 })] as const,
      ),
    ).then((pairs) => setSvgs(Object.fromEntries(pairs)));
  }, [codes.data, base]);

  const print = () => {
    const shop = settings.data?.branch.name ?? '';
    printHtml(
      `<div class="grid">${(codes.data ?? [])
        .map(
          (
            c,
          ) => `<div class="card"><div class="shop">${esc(shop)}</div><div class="table">${esc(c.tableName)}</div>
          <div class="qr">${svgs[c.tableId] ?? ''}</div>
          <div class="hint">Quét mã để gọi món · gọi nhân viên · thanh toán</div>
          <div class="url">${esc(`${base}/t/${c.token}`)}</div></div>`,
        )
        .join('')}</div>`,
      SHEET_CSS,
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Mã QR gọi món tại bàn"
      width={640}
      footer={
        <>
          <Button onClick={onClose}>Đóng</Button>
          <Button
            variant="primary"
            icon={<Printer size={16} />}
            disabled={!codes.data?.length}
            onClick={print}
          >
            In tất cả
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px]">
        {s && !s.qr_order_enabled && (
          <p className="rounded-ctl bg-warn-soft px-3 py-2 text-warn">
            Chưa bật gọi món bằng QR (Hệ thống → Cài đặt) — khách quét sẽ thấy “quán chưa bật”.
          </p>
        )}
        <p className="text-muted">
          Mã trỏ tới <b className="num text-ink">{base}</b>. Điện thoại khách vào Wi-Fi của quán phải mở được
          địa chỉ này (đổi ở Cài đặt nếu cần).
        </p>
        <FormError message={codes.error ? errorMessage(codes.error) : null} />
        <ul className="grid gap-3 sm:grid-cols-3">
          {(codes.data ?? []).map((c) => (
            <li
              key={c.tableId}
              className="flex flex-col items-center gap-1 rounded-card border border-line p-3"
            >
              <b>{c.tableName}</b>
              <span className="text-xs text-muted">{c.areaName}</span>
              <span
                className="size-28 [&_svg]:size-full"
                dangerouslySetInnerHTML={{ __html: svgs[c.tableId] ?? '' }}
              />
              <Button
                size="sm"
                variant="ghost"
                icon={<RefreshCw size={14} />}
                loading={codes.isPending && renew === c.tableId}
                onClick={() => {
                  if (renew !== c.tableId) return setRenew(c.tableId);
                  codes.mutate(c.tableId, {
                    onSuccess: () => (setRenew(null), toast(`Đã đổi mã ${c.tableName} — in lại mã bàn này`)),
                  });
                }}
              >
                {renew === c.tableId ? 'Bấm lần nữa: mã cũ hết dùng' : 'Đổi mã'}
              </Button>
            </li>
          ))}
        </ul>
        {codes.data?.length === 0 && <p className="text-muted">Chưa có bàn nào đang dùng.</p>}
      </div>
    </Dialog>
  );
}
