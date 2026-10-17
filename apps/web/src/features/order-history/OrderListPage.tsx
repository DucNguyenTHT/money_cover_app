import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Printer, Trash2 } from 'lucide-react';
import type { OrderDto, OrderSummary } from '@ketoan/api/contracts';
import { businessDateOf, type Channel, type OrderStatus } from '@ketoan/api/domain';
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Badge, Card, Segmented, Select } from '@/components/ui/controls';
import { DataTable } from '@/components/ui/DataTable';
import { useToast } from '@/components/ui/Toast';
import { SearchInput } from '@/components/ui/SearchInput';
import { client, errorMessage, ok } from '@/lib/api-client';
import { dateVi, money } from '@/lib/format';
import { ApprovalProvider } from '@/pos/Approval';
import { usePosMaybe } from '@/pos/context';
import { CHANNEL_LABEL, posKeys, useOrder, usePosSettings, whereLabel } from '@/pos/data';
import { CancelOrderDialog } from '@/pos/OrderDialogs';
import { billHtml, printHtml } from '@/pos/print';

const STATUS: Record<OrderStatus, { label: string; tone: 'primary' | 'good' | 'bad' }> = {
  OPEN: { label: 'Đang mở', tone: 'primary' },
  PAID: { label: 'Đã thanh toán', tone: 'good' },
  CANCELLED: { label: 'Đã huỷ', tone: 'bad' },
};
const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '';

/** Order list with a cancelled tab. Mounted in /pos (inside PosProvider) and /admin. */
export function OrderListPage({ inPos = false }: { inPos?: boolean }) {
  // Default to the current business date: after midnight (before business_day_start) tonight's orders
  // still belong to yesterday, and the cashier must see them.
  const settings = usePosSettings().data?.settings;
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  useEffect(() => {
    if (!settings || from) return;
    const d = businessDateOf(new Date(), settings.business_day_start);
    setFrom(d);
    setTo(d);
  }, [settings, from]);
  const [status, setStatus] = useState<OrderStatus | 'ALL'>('ALL');
  const [channel, setChannel] = useState<Channel | ''>('');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const list = useQuery({
    queryKey: [...posKeys.orders, from, to, status, channel, q],
    enabled: !!from && !!to,
    queryFn: async () =>
      ok(
        await client.orders.list({
          query: {
            from,
            to,
            ...(status !== 'ALL' ? { status } : {}),
            ...(channel ? { channel } : {}),
            ...(q.trim() ? { q: q.trim() } : {}),
          },
        }),
      ),
  });
  const rows = list.data ?? [];
  const paid = rows.filter((r) => r.status === 'PAID');
  const revenue = paid.reduce((s, r) => s + Number(r.netRevenue), 0);

  return (
    <ApprovalProvider>
      <div className={inPos ? 'h-full overflow-y-auto p-3' : ''}>
        <PageHeader title="Danh sách đơn" subtitle="Đơn đã huỷ vẫn được lưu kèm lý do và người huỷ" />
        <Card>
          <div className="flex flex-wrap items-end gap-2.5 border-b border-line p-3">
            <label className="flex flex-col gap-1 text-xs text-muted">
              Từ ngày
              <Input
                type="date"
                value={from}
                max={to}
                onChange={(e) => setFrom(e.target.value)}
                className="w-40"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Đến ngày
              <Input
                type="date"
                value={to}
                min={from}
                onChange={(e) => setTo(e.target.value)}
                className="w-40"
              />
            </label>
            <div className="w-40">
              <Select
                aria-label="Kênh bán"
                value={channel}
                onChange={(e) => setChannel(e.target.value as Channel | '')}
              >
                <option value="">Tất cả kênh</option>
                {(Object.keys(CHANNEL_LABEL) as Channel[]).map((c) => (
                  <option key={c} value={c}>
                    {CHANNEL_LABEL[c]}
                  </option>
                ))}
              </Select>
            </div>
            <SearchInput
              className="w-48"
              aria-label="Tìm mã đơn"
              placeholder="Mã đơn / mã app"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Segmented
              label="Trạng thái"
              value={status}
              onChange={setStatus}
              options={[
                { value: 'ALL', label: 'Tất cả' },
                { value: 'OPEN', label: 'Đang mở' },
                { value: 'PAID', label: 'Đã thanh toán' },
                { value: 'CANCELLED', label: 'Đã huỷ' },
              ]}
            />
            <span className="ml-auto self-center text-[13px] text-muted">
              {paid.length} đơn thanh toán · doanh thu thuần <b className="num text-ink">{money(revenue)}</b>
            </span>
          </div>
          <DataTable<OrderSummary>
            rows={rows}
            loading={list.isLoading}
            rowKey={(r) => r.id}
            onRowClick={(r) => setOpenId(r.id)}
            columns={[
              { key: 'code', header: 'Mã đơn', cell: (r) => <span className="font-medium">{r.code}</span> },
              { key: 'where', header: 'Bàn / kênh', cell: (r) => whereLabel(r) },
              {
                key: 'time',
                header: 'Giờ',
                cell: (r) =>
                  `${r.businessDate !== to || from !== to ? `${dateVi(r.businessDate)} ` : ''}${time(r.paidAt ?? r.openedAt)}`,
              },
              { key: 'staff', header: 'Nhân viên', cell: (r) => r.openedByName, secondary: true },
              {
                key: 'status',
                header: 'Trạng thái',
                cell: (r) => (
                  <span className="inline-flex flex-col items-start gap-0.5">
                    <Badge tone={STATUS[r.status].tone}>
                      {r.cancelKind === 'MERGED' ? 'Đã gộp' : STATUS[r.status].label}
                    </Badge>
                    {r.status === 'CANCELLED' && r.cancelReason && (
                      <span className="text-xs text-muted">{r.cancelReason}</span>
                    )}
                  </span>
                ),
              },
              {
                key: 'disc',
                header: 'Giảm giá',
                align: 'right',
                secondary: true,
                cell: (r) => (
                  <span className="num">
                    {money(Number(r.itemDiscountTotal) + Number(r.orderDiscountAmount))}
                  </span>
                ),
              },
              {
                key: 'total',
                header: 'Khách trả',
                align: 'right',
                cell: (r) => <b className="num">{money(r.total)}</b>,
              },
              ...(isAdmin
                ? [
                    {
                      key: 'profit',
                      header: 'Lãi đơn',
                      align: 'right' as const,
                      secondary: true,
                      cell: (r: OrderSummary) => {
                        if (r.status !== 'PAID' || r.costTotal === undefined) return '';
                        const p = Number(r.netRevenue) - Number(r.costTotal);
                        return (
                          <span className={p < 0 ? 'num font-semibold text-bad' : 'num'}>{money(p)}</span>
                        );
                      },
                    },
                  ]
                : []),
            ]}
          />
        </Card>
        <OrderDetail id={openId} inPos={inPos} onClose={() => setOpenId(null)} />
      </div>
    </ApprovalProvider>
  );
}

function OrderDetail({ id, inPos, onClose }: { id: number | null; inPos: boolean; onClose: () => void }) {
  const q = useOrder(id);
  const o = q.data;
  const [cancel, setCancel] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const pos = usePosMaybe();

  const reprint = async () => {
    if (!o) return;
    try {
      const r = ok(
        await client.orders.print({
          params: { id: o.id },
          body: { kind: o.status === 'PAID' ? 'BILL' : 'PROVISIONAL' },
        }),
      );
      if (r.printed) toast(r.message);
      else
        printHtml(
          await billHtml(ok(await client.orders.bill({ params: { id: o.id } })), o.status !== 'PAID'),
        );
    } catch (e) {
      toast(errorMessage(e), 'bad');
    }
  };
  const duplicate = async () => {
    if (!o) return;
    try {
      const n = ok(await client.orders.duplicate({ params: { id: o.id }, body: {} }));
      toast(`Đã tạo đơn mới ${n.code}`);
      qc.invalidateQueries({ queryKey: posKeys.orders });
      if (pos) {
        pos.setTarget({ orderId: n.id });
        navigate('/pos/order');
      } else onClose();
    } catch (e) {
      toast(errorMessage(e), 'bad');
    }
  };

  return (
    <Dialog
      open={id !== null}
      onClose={onClose}
      title={o ? `Đơn ${o.code}` : 'Đơn hàng'}
      width={620}
      footer={
        o && (
          <>
            {o.status !== 'CANCELLED' && (
              <Button
                variant="danger"
                className="mr-auto"
                icon={<Trash2 size={16} />}
                onClick={() => setCancel(true)}
              >
                Huỷ đơn
              </Button>
            )}
            {o.status !== 'OPEN' && (
              <Button icon={<Copy size={16} />} onClick={duplicate}>
                Sao chép thành đơn mới
              </Button>
            )}
            {o.status === 'OPEN' && inPos && pos && (
              <Button
                variant="primary"
                onClick={() => (pos.setTarget({ orderId: o.id }), navigate('/pos/order'))}
              >
                Mở đơn
              </Button>
            )}
            {o.status !== 'CANCELLED' && (
              <Button icon={<Printer size={16} />} onClick={reprint}>
                {o.status === 'PAID' ? 'In lại hoá đơn' : 'In tạm tính'}
              </Button>
            )}
          </>
        )
      }
    >
      {o && <OrderBody o={o} />}
      {o && (
        <CancelOrderDialog
          order={o}
          open={cancel}
          onClose={() => setCancel(false)}
          onDone={(n) => {
            qc.setQueryData(posKeys.order(n.id), n);
            qc.invalidateQueries({ queryKey: posKeys.orders });
            setCancel(false);
            toast(`Đã huỷ đơn ${n.code}`);
          }}
        />
      )}
    </Dialog>
  );
}

function OrderBody({ o }: { o: OrderDto }) {
  const method = { CASH: 'Tiền mặt', TRANSFER: 'Chuyển khoản', CARD: 'Thẻ', APP: 'App' } as const;
  const profit =
    o.costTotal !== undefined && o.status === 'PAID' ? Number(o.netRevenue) - Number(o.costTotal) : null;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
        <span>{whereLabel(o)}</span>
        <span>{dateVi(o.businessDate)}</span>
        <span>
          Mở {time(o.openedAt)} · {o.openedByName}
        </span>
        {o.paidAt && (
          <span>
            Thanh toán {time(o.paidAt)} · {o.paidByName}
          </span>
        )}
        <Badge tone={STATUS[o.status].tone}>{STATUS[o.status].label}</Badge>
      </div>
      {o.status === 'CANCELLED' && (
        <p className="rounded-ctl bg-bad-soft px-3 py-2 text-[13px] text-bad-ink">
          Huỷ lúc {time(o.cancelledAt)} bởi {o.cancelledByName}: {o.cancelReason}
        </p>
      )}
      <div className="divide-y divide-line-soft rounded-ctl border border-line-soft">
        {o.items.map((i) => (
          <div
            key={i.id}
            className={`num flex justify-between gap-3 px-3 py-2 ${i.status === 'CANCELLED' ? 'text-faint line-through' : ''}`}
          >
            <span>
              {i.qty} × {i.dishName}
              {i.note && <span className="text-xs text-muted"> · {i.note}</span>}
              {i.status === 'CANCELLED' && (
                <span className="block text-xs no-underline">
                  Huỷ: {i.cancelReason}
                  {i.wasted ? ' (đã chế biến)' : ''}
                </span>
              )}
            </span>
            <span>{money(Number(i.amount) - Number(i.discountAmount))}</span>
          </div>
        ))}
      </div>
      <div className="num ml-auto flex w-full max-w-xs flex-col gap-1 text-[13px]">
        <Line label="Tổng tiền hàng" v={o.subtotal} />
        {Number(o.itemDiscountTotal) + Number(o.orderDiscountAmount) > 0 && (
          <Line
            label={`Giảm giá${o.discountReason ? ` (${o.discountReason})` : ''}`}
            v={String(-(Number(o.itemDiscountTotal) + Number(o.orderDiscountAmount)))}
          />
        )}
        {Number(o.serviceChargeAmount) > 0 && <Line label="Phụ thu" v={o.serviceChargeAmount} />}
        {Number(o.vatAmount) > 0 && <Line label={`VAT ${Number(o.vatPct)}%`} v={o.vatAmount} />}
        <div className="flex justify-between border-t border-line pt-1 text-base font-bold">
          <span>Khách trả</span>
          <span>{money(o.total)}</span>
        </div>
        {o.payments.map((p, k) => (
          <Line key={k} label={method[p.method]} v={p.amount} />
        ))}
        {profit !== null && (
          <div className={`flex justify-between ${profit < 0 ? 'font-semibold text-bad' : 'text-muted'}`}>
            <span>Giá vốn {money(o.costTotal)} · lãi đơn</span>
            <span>
              {money(profit)}
              {profit < 0 && ' (Lỗ)'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

const Line = ({ label, v }: { label: string; v: string }) => (
  <div className="flex justify-between text-muted">
    <span>{label}</span>
    <span>{money(v)}</span>
  </div>
);

export const PosOrderListPage = () => <OrderListPage inPos />;
