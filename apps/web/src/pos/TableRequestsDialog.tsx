import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BellRing, Check, Receipt, UtensilsCrossed, X } from 'lucide-react';
import type { TableRequestDto } from '@ketoan/api/contracts';
import type { TableRequestKind } from '@ketoan/api/domain';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { ReasonDialog } from '@/components/ReasonDialog';
import { useToast } from '@/components/ui/Toast';
import { client, errorMessage, ok } from '@/lib/api-client';
import { minutesSince, posKeys, useTableRequests } from './data';

export const REQUEST_LABEL: Record<TableRequestKind, string> = {
  ORDER: 'Gọi món',
  CALL: 'Gọi nhân viên',
  BILL: 'Xin thanh toán',
};
const ICON = { ORDER: UtensilsCrossed, CALL: BellRing, BILL: Receipt } as const;

/** Waiting requests from the table QR (one table, or all): accept (dishes go into the table's order) or decline. */
export function TableRequestsDialog({
  tableId,
  onClose,
  onAccepted,
}: {
  tableId: number | null;
  onClose: () => void;
  onAccepted: (r: TableRequestDto) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const all = useTableRequests().data ?? [];
  const rows = all.filter((r) => tableId === null || r.tableId === tableId);
  const waiting = rows.filter((r) => r.status === 'PENDING');
  const done = rows.filter((r) => r.status !== 'PENDING').reverse();
  const [busy, setBusy] = useState<number | null>(null);
  const [declining, setDeclining] = useState<TableRequestDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const accept = async (r: TableRequestDto) => {
    setBusy(r.id);
    setError(null);
    try {
      const res = ok(await client.tableRequests.accept({ params: { id: r.id }, body: {} }));
      qc.invalidateQueries({ queryKey: posKeys.tableRequests });
      qc.invalidateQueries({ queryKey: posKeys.floor });
      toast(
        r.kind === 'ORDER'
          ? `Đã thêm món của ${r.tableName} vào đơn — bấm Gửi bếp`
          : `Đã nhận: ${r.tableName}`,
      );
      onAccepted(res);
    } catch (e) {
      setError(errorMessage(e));
      qc.invalidateQueries({ queryKey: posKeys.tableRequests });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={tableId === null ? 'Yêu cầu từ bàn (QR)' : `Yêu cầu từ ${rows[0]?.tableName ?? 'bàn'}`}
      width={560}
      footer={<Button onClick={onClose}>Đóng</Button>}
    >
      <div className="flex flex-col gap-3 text-[13px]">
        {error && <p className="rounded-ctl bg-bad-soft px-3 py-2 text-bad">{error}</p>}
        {waiting.length === 0 && <p className="text-muted">Không có yêu cầu đang chờ.</p>}
        {waiting.map((r) => {
          const Icon = ICON[r.kind];
          return (
            <div key={r.id} className="rounded-card border border-line p-3">
              <div className="mb-1.5 flex items-center gap-2">
                <Icon size={16} className="text-primary-ink" />
                <b className="text-[15px]">{r.tableName}</b>
                <span>· {REQUEST_LABEL[r.kind]}</span>
                <span className="ml-auto text-muted">{minutesSince(r.createdAt)}′ trước</span>
              </div>
              {r.items.length > 0 && (
                <ul className="mb-1.5 flex flex-col gap-0.5">
                  {r.items.map((i, k) => (
                    <li key={k}>
                      <b className="num">{i.qty} ×</b> {i.name}
                      {i.options && <span className="text-muted"> ({i.options})</span>}
                      {i.note && <span className="text-warn"> · {i.note}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {r.note && <p className="mb-1.5 text-warn">Ghi chú: {r.note}</p>}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  icon={<Check size={14} />}
                  loading={busy === r.id}
                  onClick={() => accept(r)}
                >
                  {r.kind === 'ORDER' ? 'Nhận vào đơn' : 'Đã xử lý'}
                </Button>
                <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={() => setDeclining(r)}>
                  Từ chối
                </Button>
              </div>
            </div>
          );
        })}
        {done.length > 0 && (
          <details className="text-muted">
            <summary className="cursor-pointer">Đã xử lý trong 1 giờ qua ({done.length})</summary>
            <ul className="mt-1.5 flex flex-col gap-1">
              {done.map((r) => (
                <li key={r.id}>
                  {r.tableName} · {REQUEST_LABEL[r.kind]}
                  {r.kind === 'ORDER' ? ` (${r.items.reduce((s, i) => s + i.qty, 0)} phần)` : ''} —{' '}
                  {r.status === 'ACCEPTED' ? 'đã nhận' : `từ chối: ${r.rejectReason}`}
                  {r.handledByName ? ` · ${r.handledByName}` : ''}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <ReasonDialog
        open={!!declining}
        title={`Từ chối · ${declining?.tableName ?? ''}`}
        confirmLabel="Từ chối"
        onClose={() => setDeclining(null)}
        onConfirm={async (reason) => {
          ok(await client.tableRequests.reject({ params: { id: declining!.id }, body: { reason } }));
          qc.invalidateQueries({ queryKey: posKeys.tableRequests });
        }}
      />
    </Dialog>
  );
}
