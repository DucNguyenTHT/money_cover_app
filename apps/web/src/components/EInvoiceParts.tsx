// E-invoice pieces shared by the payment screen, the order detail and the admin list.
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FileCheck2, RotateCw } from 'lucide-react';
import type { BuyerDto, OrderDto } from '@ketoan/api/contracts';
import type { EInvoiceStatus } from '@ketoan/api/domain';
import { Button } from '@/components/ui/Button';
import { Badge, type BadgeTone } from '@/components/ui/controls';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { client, errorMessage, ok } from '@/lib/api-client';

/** Whether this shop issues e-invoices, and how (read by the tills). */
export const useEInvoicePos = () =>
  useQuery({
    queryKey: ['einvoice', 'pos'],
    queryFn: async () => ok(await client.einvoice.posInfo()),
    staleTime: 60_000,
  });

export const EINVOICE_STATUS: Record<EInvoiceStatus, { label: string; tone: BadgeTone }> = {
  PENDING: { label: 'Chờ gửi', tone: 'primary' },
  SENDING: { label: 'Đang phát hành', tone: 'primary' },
  ISSUED: { label: 'Đã phát hành', tone: 'good' },
  FAILED: { label: 'Bị từ chối', tone: 'bad' },
  CANCELLED: { label: 'Đã huỷ', tone: 'neutral' },
};

export const emptyBuyer: BuyerDto = { name: '', taxCode: '', address: '', email: '' };

/** Company / person asking for the invoice in their name. */
export function BuyerFields({ value, onChange }: { value: BuyerDto; onChange: (b: BuyerDto) => void }) {
  const field = (k: keyof BuyerDto, label: string, extra: object = {}) => (
    <label className="flex flex-col gap-1 text-xs text-muted">
      {label}
      <Input
        value={value[k] ?? ''}
        onChange={(e) => onChange({ ...value, [k]: e.target.value })}
        className="h-9 text-[13px]"
        {...extra}
      />
    </label>
  );
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2">
      {field('name', 'Tên đơn vị / người mua')}
      {field('taxCode', 'Mã số thuế', { inputMode: 'numeric', className: 'num h-9 text-[13px]' })}
      <div className="sm:col-span-2">{field('address', 'Địa chỉ')}</div>
      <div className="sm:col-span-2">{field('email', 'Email nhận hoá đơn', { type: 'email' })}</div>
    </div>
  );
}

/** Invoice of a paid / cancelled order: its state, and issue / send again. */
export function EInvoiceBox({ order, onChanged }: { order: OrderDto; onChanged: () => void }) {
  const info = useEInvoicePos().data;
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const [buyer, setBuyer] = useState<BuyerDto>(emptyBuyer);
  const inv = order.einvoice;
  const issue = useMutation({
    mutationFn: async () =>
      ok(await client.einvoice.issueForOrder({ params: { orderId: order.id }, body: { buyer } })),
    onSuccess: (r) => {
      setAsking(false);
      onChanged();
      toast(
        r.status === 'ISSUED' ? `Đã phát hành hoá đơn số ${r.invoiceNo ?? ''}` : 'Đã gửi, đang chờ phát hành',
      );
    },
    onError: (e) => toast(errorMessage(e), 'bad'),
  });
  const retry = useMutation({
    mutationFn: async () => ok(await client.einvoice.retry({ params: { id: inv!.id }, body: {} })),
    onSuccess: (r) => {
      onChanged();
      toast(
        r.status === 'ISSUED' ? 'Đã phát hành' : r.lastError ? `Chưa được: ${r.lastError}` : 'Đã gửi lại',
      );
    },
    onError: (e) => toast(errorMessage(e), 'bad'),
  });
  if (!inv && (!info?.enabled || order.status !== 'PAID')) return null;
  return (
    <div className="flex flex-col gap-2 rounded-ctl border border-line-soft p-3 text-[13px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-semibold">
          <FileCheck2 size={16} className="text-primary-ink" /> Hoá đơn điện tử
          {inv?.provider === 'MOCK' && <span className="font-normal text-faint">(giả lập)</span>}
        </span>
        {inv ? (
          <Badge tone={EINVOICE_STATUS[inv.status].tone}>{EINVOICE_STATUS[inv.status].label}</Badge>
        ) : (
          <Badge>Chưa xuất</Badge>
        )}
      </div>
      {inv?.status === 'ISSUED' && (
        <span className="text-muted">
          Số <b className="num text-ink">{inv.invoiceNo ?? '—'}</b>
          {inv.series ? ` · ký hiệu ${inv.series}` : ''}
          {inv.lookupCode ? ` · mã tra cứu ${inv.lookupCode}` : ''}
          {inv.lookupUrl && (
            <>
              {' · '}
              <a className="text-primary-ink underline" href={inv.lookupUrl} target="_blank" rel="noreferrer">
                xem hoá đơn
              </a>
            </>
          )}
        </span>
      )}
      {inv?.adjustment && (
        <span className="text-warn">
          Đơn đã huỷ → hoá đơn điều chỉnh giảm: {EINVOICE_STATUS[inv.adjustment].label.toLowerCase()}
        </span>
      )}
      {inv?.lastError && inv.status !== 'ISSUED' && <span className="text-bad-ink">{inv.lastError}</span>}
      {order.status === 'PAID' &&
        info?.enabled &&
        (!inv || inv.status === 'FAILED' || inv.status === 'CANCELLED') && (
          <>
            {asking && <BuyerFields value={buyer} onChange={setBuyer} />}
            <div className="flex gap-2">
              {!asking ? (
                <Button size="sm" variant="tonal" onClick={() => setAsking(true)}>
                  {inv ? 'Xuất lại hoá đơn' : 'Xuất hoá đơn'}
                </Button>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="primary"
                    loading={issue.isPending}
                    onClick={() => issue.mutate()}
                  >
                    Xuất
                  </Button>
                  <Button size="sm" onClick={() => setAsking(false)}>
                    Huỷ bỏ
                  </Button>
                </>
              )}
            </div>
          </>
        )}
      {inv?.status === 'PENDING' && (
        <div>
          <Button
            size="sm"
            icon={<RotateCw size={14} />}
            loading={retry.isPending}
            onClick={() => retry.mutate()}
          >
            Gửi ngay
          </Button>
        </div>
      )}
    </div>
  );
}
