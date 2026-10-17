import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Users } from 'lucide-react';
import type { AreaDto, TableDto } from '@ketoan/api/contracts';
import { PageHeader } from '@/components/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { Card, EmptyState, Switch } from '@/components/ui/controls';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { FormError } from '@/auth/AuthCard';
import { client, errorMessage, ok } from '@/lib/api-client';
import { cn } from '@/lib/cn';

export function TablesPage() {
  const qc = useQueryClient();
  const areas = useQuery({ queryKey: ['areas'], queryFn: async () => ok(await client.venue.listAreas()) });
  const [area, setArea] = useState<AreaDto | 'new' | null>(null);
  const [table, setTable] = useState<{ areaId: number; table: TableDto | null } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['areas'] });

  return (
    <div>
      <PageHeader
        title="Bàn & khu vực"
        subtitle="Sơ đồ bàn hiển thị trên màn hình bán hàng theo đúng thứ tự ở đây"
        actions={
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setArea('new')}>
            Thêm khu vực
          </Button>
        }
      />
      <div className="flex flex-col gap-4">
        {areas.data?.length === 0 && (
          <Card>
            <EmptyState
              title="Chưa có khu vực"
              hint="Tạo khu vực (VD: Tầng 1, Sân vườn) rồi thêm bàn vào từng khu."
            />
          </Card>
        )}
        {areas.data?.map((a) => (
          <Card key={a.id}>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="font-semibold text-ink-strong">
                {a.name}{' '}
                <span className="font-normal text-muted">
                  · {a.tables.filter((t) => t.active).length} bàn
                </span>
              </h2>
              <div className="flex gap-2">
                <IconButton label={`Sửa khu vực ${a.name}`} size={34} onClick={() => setArea(a)}>
                  <Pencil size={16} />
                </IconButton>
                <Button
                  size="sm"
                  variant="tonal"
                  icon={<Plus size={15} />}
                  onClick={() => setTable({ areaId: a.id, table: null })}
                >
                  Thêm bàn
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2.5 p-4 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
              {a.tables.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTable({ areaId: a.id, table: t })}
                  className={cn(
                    'flex h-20 flex-col items-center justify-center gap-1 rounded-card border text-sm hover:border-primary',
                    t.active ? 'border-line bg-white' : 'border-dashed border-field bg-page text-faint',
                  )}
                >
                  <span className="font-semibold">{t.name}</span>
                  <span className="flex items-center gap-1 text-xs text-muted">
                    <Users size={12} /> {t.seats} chỗ {!t.active && '· ẩn'}
                  </span>
                </button>
              ))}
              {a.tables.length === 0 && (
                <p className="col-span-full text-[13px] text-muted">Chưa có bàn trong khu này.</p>
              )}
            </div>
          </Card>
        ))}
      </div>

      {area && (
        <AreaForm
          area={area === 'new' ? null : area}
          nextSort={(areas.data?.length ?? 0) + 1}
          onClose={() => setArea(null)}
          onSaved={refresh}
        />
      )}
      {table && (
        <TableForm
          areaId={table.areaId}
          table={table.table}
          nextSort={(areas.data?.find((a) => a.id === table.areaId)?.tables.length ?? 0) + 1}
          onClose={() => setTable(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}

function AreaForm({
  area,
  nextSort,
  onClose,
  onSaved,
}: {
  area: AreaDto | null;
  nextSort: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(area?.name ?? '');
  const [sort, setSort] = useState(String(area?.sort ?? nextSort));
  const save = useMutation({
    mutationFn: async () => {
      const body = { name, sort: Number(sort) || 0 };
      return area
        ? ok(await client.venue.updateArea({ params: { id: area.id }, body }))
        : ok(await client.venue.createArea({ body }));
    },
    onSuccess: () => {
      toast('Đã lưu khu vực');
      onSaved();
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={area ? `Sửa khu vực: ${area.name}` : 'Thêm khu vực'}
      width={420}
      footer={
        <>
          <Button onClick={onClose}>Huỷ bỏ</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Tên khu vực">
          {(id) => (
            <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Tầng 2" />
          )}
        </Field>
        <Field label="Thứ tự hiển thị">
          {(id) => (
            <Input id={id} inputMode="numeric" value={sort} onChange={(e) => setSort(e.target.value)} />
          )}
        </Field>
        <FormError message={save.error ? errorMessage(save.error) : null} />
      </div>
    </Dialog>
  );
}

function TableForm({
  areaId,
  table,
  nextSort,
  onClose,
  onSaved,
}: {
  areaId: number;
  table: TableDto | null;
  nextSort: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(table?.name ?? `Bàn ${String(nextSort).padStart(2, '0')}`);
  const [seats, setSeats] = useState(String(table?.seats ?? 4));
  const [sort, setSort] = useState(String(table?.sort ?? nextSort));
  const [active, setActive] = useState(table?.active ?? true);
  const save = useMutation({
    mutationFn: async () => {
      const body = { areaId, name, seats: Number(seats) || 1, sort: Number(sort) || 0, active };
      return table
        ? ok(await client.venue.updateTable({ params: { id: table.id }, body }))
        : ok(await client.venue.createTable({ body }));
    },
    onSuccess: () => {
      toast('Đã lưu bàn');
      onSaved();
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={table ? `Sửa ${table.name}` : 'Thêm bàn'}
      width={420}
      footer={
        <>
          <Button onClick={onClose}>Huỷ bỏ</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Tên bàn">
            {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
        </div>
        <Field label="Số chỗ">
          {(id) => (
            <Input id={id} inputMode="numeric" value={seats} onChange={(e) => setSeats(e.target.value)} />
          )}
        </Field>
        <Field label="Thứ tự">
          {(id) => (
            <Input id={id} inputMode="numeric" value={sort} onChange={(e) => setSort(e.target.value)} />
          )}
        </Field>
        {table && (
          <div className="sm:col-span-2">
            <Switch
              checked={active}
              onChange={setActive}
              label="Hiện trên sơ đồ bàn"
              description="Tắt để ẩn bàn tạm không dùng"
            />
          </div>
        )}
        <div className="sm:col-span-2">
          <FormError message={save.error ? errorMessage(save.error) : null} />
        </div>
      </div>
    </Dialog>
  );
}
