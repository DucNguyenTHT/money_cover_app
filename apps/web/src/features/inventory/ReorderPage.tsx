import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ClipboardPlus } from 'lucide-react';
import type { StockRow } from '@ketoan/api/contracts';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge, Card, EmptyState } from '@/components/ui/controls';
import { DataTable } from '@/components/ui/DataTable';
import { client, ok } from '@/lib/api-client';
import { qtyUnit } from '@/lib/format';
import { RECEIPT_PREFILL_KEY, type ReceiptPrefill } from './receipt-prefill';

const STATUS: Record<StockRow['status'], { label: string; tone: 'bad' | 'warn' | 'good' }> = {
  OUT: { label: 'Hết hàng', tone: 'bad' },
  LOW: { label: 'Sắp hết', tone: 'warn' },
  OK: { label: 'Đủ', tone: 'good' },
};

/** Suggested purchase in the unit the shop buys in ("2 thùng (48 lon)"). */
export const suggestText = (r: StockRow) =>
  r.purchaseUnit
    ? `${qtyUnit(r.suggestPurchaseQty, r.purchaseUnit)} (${qtyUnit(r.suggestQty, r.unit)})`
    : qtyUnit(r.suggestQty, r.unit);

/** "Cần nhập hàng": what runs out soon at the recent pace, and how much to buy. */
export function ReorderPage() {
  const navigate = useNavigate();
  const stock = useQuery({
    queryKey: ['inventory'],
    queryFn: async () => ok(await client.inventory.stock()),
  });
  const settings = useQuery({ queryKey: ['settings'], queryFn: async () => ok(await client.settings.get()) });
  const rows = useMemo(
    () =>
      (stock.data ?? [])
        .filter((r) => r.status !== 'OK')
        .sort((a, b) =>
          a.status === b.status ? (a.daysLeft ?? 0) - (b.daysLeft ?? 0) : a.status === 'OUT' ? -1 : 1,
        ),
    [stock.data],
  );
  const [picked, setPicked] = useState<number[] | null>(null);
  const chosen = picked ?? rows.map((r) => r.ingredientId);
  const days = settings.data?.settings.reorder_days ?? 3;

  const toReceipt = () => {
    const lines: ReceiptPrefill = rows
      .filter((r) => chosen.includes(r.ingredientId))
      .map((r) => ({
        ingredientId: r.ingredientId,
        purchase: !!r.purchaseUnit,
        qty: r.purchaseUnit ? r.suggestPurchaseQty : r.suggestQty,
        unitPrice: r.lastPrice
          ? String(Math.round(Number(r.lastPrice) * (r.purchaseUnit ? Number(r.purchaseFactor) : 1)))
          : '',
      }));
    try {
      sessionStorage.setItem(RECEIPT_PREFILL_KEY, JSON.stringify(lines));
    } catch {
      /* private mode: the receipt simply opens empty */
    }
    navigate('/admin/inventory/receipts?from=reorder');
  };

  return (
    <div>
      <PageHeader
        title="Cần nhập hàng"
        subtitle={`Theo lượng dùng 14 ngày gần nhất và tồn tối thiểu; gợi ý nhập đủ dùng ${days} ngày (đổi ở Cài đặt)`}
        actions={
          rows.length > 0 && (
            <Button
              variant="primary"
              icon={<ClipboardPlus size={16} />}
              disabled={!chosen.length}
              onClick={toReceipt}
            >
              Tạo phiếu nhập ({chosen.length})
            </Button>
          )
        }
      />
      <Card>
        <DataTable<StockRow>
          rows={rows}
          loading={stock.isLoading}
          rowKey={(r) => r.ingredientId}
          empty={
            <EmptyState
              title="Không có nguyên liệu nào sắp hết"
              hint='Đặt "Tồn tối thiểu" cho nguyên liệu để được nhắc sớm hơn.'
              action={
                <Link className="text-primary-ink underline" to="/admin/menu/ingredients">
                  Thực đơn → Nguyên liệu
                </Link>
              }
            />
          }
          columns={[
            {
              key: 'name',
              header: 'Nguyên liệu',
              cell: (r) => (
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    aria-label={`Chọn ${r.name}`}
                    className="size-4 accent-primary"
                    checked={chosen.includes(r.ingredientId)}
                    onChange={(e) =>
                      setPicked(
                        e.target.checked
                          ? [...chosen, r.ingredientId]
                          : chosen.filter((x) => x !== r.ingredientId),
                      )
                    }
                  />
                  {r.name} <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                </span>
              ),
            },
            {
              key: 'onHand',
              header: 'Tồn',
              align: 'right',
              cell: (r) => (
                <span className="num">
                  {qtyUnit(r.qtyOnHand, r.unit)}
                  {Number(r.pendingQty) > 0 && (
                    <span className="block text-xs text-warn">nợ kho {qtyUnit(r.pendingQty, r.unit)}</span>
                  )}
                </span>
              ),
            },
            {
              key: 'use',
              header: 'Dùng / ngày',
              align: 'right',
              secondary: true,
              cell: (r) => (
                <span className="num">{Number(r.dailyUse) ? qtyUnit(r.dailyUse, r.unit) : '—'}</span>
              ),
            },
            {
              key: 'days',
              header: 'Đủ dùng',
              align: 'right',
              cell: (r) => (r.daysLeft === null ? '—' : `${String(r.daysLeft).replace('.', ',')} ngày`),
            },
            {
              key: 'min',
              header: 'Tối thiểu',
              align: 'right',
              secondary: true,
              cell: (r) => (r.minStock ? <span className="num">{qtyUnit(r.minStock, r.unit)}</span> : '—'),
            },
            {
              key: 'suggest',
              header: 'Nên nhập',
              align: 'right',
              cell: (r) => <b className="num">{suggestText(r)}</b>,
            },
          ]}
        />
      </Card>
    </div>
  );
}
