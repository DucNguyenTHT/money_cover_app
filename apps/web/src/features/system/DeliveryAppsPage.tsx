import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import type { DeliveryAppDto } from '@ketoan/api/contracts';
import { PageHeader } from '@/components/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, Card, EmptyState, Switch } from '@/components/ui/controls';
import { DataTable } from '@/components/ui/DataTable';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { FormError } from '@/auth/AuthCard';
import { client, errorMessage, ok } from '@/lib/api-client';

export function DeliveryAppsPage() {
  const qc = useQueryClient();
  const apps = useQuery({
    queryKey: ['delivery-apps'],
    queryFn: async () => ok(await client.venue.listDeliveryApps()),
  });
  const [editing, setEditing] = useState<DeliveryAppDto | 'new' | null>(null);

  return (
    <div>
      <PageHeader
        title="App giao hàng"
        subtitle="% chiết khấu dùng để tính lãi đơn app và gợi ý giá bán trên app"
        actions={
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditing('new')}>
            Thêm app
          </Button>
        }
      />
      <Card>
        <DataTable
          rows={apps.data}
          loading={apps.isLoading}
          rowKey={(a) => a.id}
          onRowClick={(a) => setEditing(a)}
          empty={<EmptyState title="Chưa có app giao hàng" hint="VD: Grab 25%, ShopeeFood 20%." />}
          columns={[
            { key: 'name', header: 'Tên app', cell: (a) => a.name },
            {
              key: 'pct',
              header: 'Chiết khấu',
              align: 'right',
              cell: (a) => <span className="num">{Number(a.commissionPct)}%</span>,
            },
            {
              key: 'status',
              header: 'Trạng thái',
              cell: (a) => (a.active ? <Badge tone="good">Đang dùng</Badge> : <Badge>Ngừng</Badge>),
            },
          ]}
          actions={(a) => (
            <IconButton label="Sửa" size={34} onClick={() => setEditing(a)}>
              <Pencil size={16} />
            </IconButton>
          )}
        />
      </Card>
      {editing && (
        <AppForm
          app={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => qc.invalidateQueries({ queryKey: ['delivery-apps'] })}
        />
      )}
    </div>
  );
}

function AppForm({
  app,
  onClose,
  onSaved,
}: {
  app: DeliveryAppDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(app?.name ?? '');
  const [pct, setPct] = useState(app?.commissionPct ?? '');
  const [active, setActive] = useState(app?.active ?? true);
  const save = useMutation({
    mutationFn: async () => {
      const body = { name, commissionPct: pct.replace(',', '.'), active };
      return app
        ? ok(await client.venue.updateDeliveryApp({ params: { id: app.id }, body }))
        : ok(await client.venue.createDeliveryApp({ body }));
    },
    onSuccess: () => {
      toast('Đã lưu');
      onSaved();
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={app ? `Sửa: ${app.name}` : 'Thêm app giao hàng'}
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
        <Field label="Tên app">
          {(id) => (
            <Input
              id={id}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="VD: GrabFood"
            />
          )}
        </Field>
        <Field label="Chiết khấu (%)">
          {(id) => (
            <Input
              id={id}
              inputMode="decimal"
              className="num text-right"
              value={pct}
              onChange={(e) => setPct(e.target.value)}
            />
          )}
        </Field>
        {app && <Switch checked={active} onChange={setActive} label="Đang dùng" />}
        <FormError message={save.error ? errorMessage(save.error) : null} />
      </div>
    </Dialog>
  );
}
