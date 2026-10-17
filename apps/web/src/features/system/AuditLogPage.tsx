import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';

import type { AuditLogDto } from '@ketoan/api/contracts';
import { PageHeader } from '@/components/PageHeader';
import { RangePicker, thisMonthRange, type Range } from '@/components/report';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';

import { Card, Select } from '@/components/ui/controls';
import { DataTable } from '@/components/ui/DataTable';
import { SearchInput } from '@/components/ui/SearchInput';
import { client, ok } from '@/lib/api-client';

const ENTITY: Record<string, string> = {
  order: 'Đơn hàng',
  receipt: 'Phiếu nhập',
  issue: 'Phiếu xuất',
  stocktake: 'Kiểm kê',
  dish: 'Món',
  dish_price: 'Giá bán',
  recipe: 'Định mức',
  dish_category: 'Nhóm món',
  ingredient: 'Nguyên liệu',
  user: 'Tài khoản',
  settings: 'Cài đặt',
  period: 'Khoá sổ',
  day_closing: 'Chốt ngày',
  overhead: 'Chi phí chung',
  table: 'Bàn',
  area: 'Khu vực',
  delivery_app: 'App giao hàng',
  printer: 'Máy in',
  import: 'Nhập Excel',
};

export function AuditLogPage() {
  const [range, setRange] = useState<Range>(thisMonthRange);
  const [entity, setEntity] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<AuditLogDto | null>(null);
  const query = useInfiniteQuery({
    queryKey: ['audit', range, entity, q],
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam }) =>
      ok(
        await client.reports.auditLogs({
          query: {
            ...range,
            ...(entity ? { entity } : {}),
            ...(q.trim() ? { q: q.trim() } : {}),
            ...(pageParam ? { before: pageParam } : {}),
          },
        }),
      ),
    getNextPageParam: (last) => (last.hasMore ? last.rows[last.rows.length - 1]?.id : undefined),
  });
  const rows = query.data?.pages.flatMap((p) => p.rows) ?? [];
  const entities = query.data?.pages[0]?.entities ?? [];

  return (
    <div>
      <PageHeader
        title="Lịch sử sửa"
        subtitle="Mọi thao tác sửa / huỷ / xoá / giảm giá / khoá sổ, kèm lý do và người duyệt"
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <RangePicker value={range} onChange={setRange} />
        <div className="w-44">
          <Select aria-label="Loại" value={entity} onChange={(e) => setEntity(e.target.value)}>
            <option value="">Tất cả loại</option>
            {entities.map((e) => (
              <option key={e} value={e}>
                {ENTITY[e] ?? e}
              </option>
            ))}
          </Select>
        </div>
        <SearchInput
          className="w-56 h-9"
          aria-label="Tìm"
          placeholder="Mã chứng từ / lý do"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <Card>
        <DataTable<AuditLogDto>
          rows={rows}
          loading={query.isLoading}
          rowKey={(r) => r.id}
          onRowClick={setOpen}
          columns={[
            { key: 'time', header: 'Thời điểm', cell: (r) => new Date(r.createdAt).toLocaleString('vi-VN') },
            { key: 'entity', header: 'Loại', cell: (r) => `${ENTITY[r.entity] ?? r.entity} #${r.entityId}` },
            {
              key: 'action',
              header: 'Thao tác',
              cell: (r) => <code className="text-[12px]">{r.action}</code>,
            },
            { key: 'reason', header: 'Lý do', cell: (r) => r.reason ?? '' },
            { key: 'user', header: 'Người làm', cell: (r) => r.userName ?? '' },
            { key: 'approved', header: 'Người duyệt', cell: (r) => r.approvedByName ?? '', secondary: true },
          ]}
        />
        {query.hasNextPage && (
          <div className="flex justify-center p-3">
            <Button loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
              Tải thêm
            </Button>
          </div>
        )}
      </Card>
      <Dialog
        open={!!open}
        onClose={() => setOpen(null)}
        title={open ? `${ENTITY[open.entity] ?? open.entity} #${open.entityId} · ${open.action}` : ''}
        width={720}
      >
        {open && (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2">
            <JsonBox title="Trước" value={open.before} />
            <JsonBox title="Sau" value={open.after} />
          </div>
        )}
      </Dialog>
    </div>
  );
}

const JsonBox = ({ title, value }: { title: string; value: unknown }) => (
  <div className="min-w-0">
    <h3 className="mb-1 text-[13px] font-semibold">{title}</h3>
    <pre className="max-h-96 overflow-auto rounded-ctl bg-page p-3 text-xs">
      {value == null ? '—' : JSON.stringify(value, null, 2)}
    </pre>
  </div>
);
