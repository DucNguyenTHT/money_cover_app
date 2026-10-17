import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Printer } from 'lucide-react';
import type { PrinterDto } from '@ketoan/api/contracts';
import { PageHeader } from '@/components/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, Card, EmptyState, Select, Switch } from '@/components/ui/controls';
import { DataTable } from '@/components/ui/DataTable';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { FormError } from '@/auth/AuthCard';
import { client, errorMessage, ok } from '@/lib/api-client';

const ROLE = { BILL: 'Hoá đơn (quầy thu ngân)', KITCHEN: 'Phiếu bếp', BAR: 'Phiếu quầy bar' } as const;

export function PrintersPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const printers = useQuery({
    queryKey: ['printers'],
    queryFn: async () => ok(await client.venue.listPrinters()),
  });
  const [editing, setEditing] = useState<PrinterDto | 'new' | null>(null);
  const test = useMutation({
    mutationFn: async (id: number) => ok(await client.venue.testPrinter({ params: { id }, body: {} })),
    onSuccess: () => toast('Đã gửi trang in thử'),
    onError: (e) => toast(errorMessage(e), 'bad'),
  });

  return (
    <div>
      <PageHeader
        title="Máy in & trạm"
        subtitle="Máy in nhiệt trong mạng LAN của quán. Server in trực tiếp qua cổng 9100."
        actions={
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditing('new')}>
            Thêm máy in
          </Button>
        }
      />
      <Card>
        <DataTable
          rows={printers.data}
          loading={printers.isLoading}
          rowKey={(p) => p.id}
          onRowClick={(p) => setEditing(p)}
          empty={
            <EmptyState
              title="Chưa có máy in"
              hint="Thêm máy in hoá đơn, máy in bếp và máy in quầy bar (nếu có)."
            />
          }
          columns={[
            { key: 'name', header: 'Tên', cell: (p) => p.name },
            { key: 'role', header: 'Dùng cho', cell: (p) => ROLE[p.role] },
            {
              key: 'ip',
              header: 'Địa chỉ',
              cell: (p) => (
                <span className="num">
                  {p.ip}:{p.port}
                </span>
              ),
            },
            { key: 'paper', header: 'Khổ giấy', secondary: true, cell: (p) => `${p.paperWidth}mm` },
            {
              key: 'status',
              header: 'Trạng thái',
              cell: (p) => (p.active ? <Badge tone="good">Đang dùng</Badge> : <Badge>Tắt</Badge>),
            },
          ]}
          actions={(p) => (
            <>
              <IconButton
                label="In thử"
                size={34}
                disabled={test.isPending}
                onClick={() => test.mutate(p.id)}
              >
                <Printer size={16} />
              </IconButton>
              <IconButton label="Sửa" size={34} onClick={() => setEditing(p)}>
                <Pencil size={16} />
              </IconButton>
            </>
          )}
        />
      </Card>
      {editing && (
        <PrinterForm
          printer={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => qc.invalidateQueries({ queryKey: ['printers'] })}
        />
      )}
    </div>
  );
}

function PrinterForm({
  printer,
  onClose,
  onSaved,
}: {
  printer: PrinterDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [f, setF] = useState({
    name: printer?.name ?? '',
    ip: printer?.ip ?? '192.168.1.',
    port: String(printer?.port ?? 9100),
    paperWidth: String(printer?.paperWidth ?? 80),
    role: printer?.role ?? 'BILL',
    active: printer?.active ?? true,
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: f.name,
        ip: f.ip.trim(),
        port: Number(f.port) || 9100,
        paperWidth: (f.paperWidth === '58' ? 58 : 80) as 58 | 80,
        role: f.role as PrinterDto['role'],
        active: f.active,
      };
      return printer
        ? ok(await client.venue.updatePrinter({ params: { id: printer.id }, body }))
        : ok(await client.venue.createPrinter({ body }));
    },
    onSuccess: () => {
      toast('Đã lưu máy in');
      onSaved();
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={printer ? `Sửa: ${printer.name}` : 'Thêm máy in'}
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
        <Field label="Tên máy in">
          {(id) => <Input id={id} value={f.name} onChange={set('name')} placeholder="VD: Máy in quầy" />}
        </Field>
        <Field label="Dùng cho">
          {(id) => (
            <Select id={id} value={f.role} onChange={set('role')}>
              {Object.entries(ROLE).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Địa chỉ IP" hint="Xem trên phiếu tự in của máy in">
          {(id, d) => (
            <Input id={id} aria-describedby={d} className="num" value={f.ip} onChange={set('ip')} />
          )}
        </Field>
        <Field label="Cổng">
          {(id) => (
            <Input id={id} inputMode="numeric" className="num" value={f.port} onChange={set('port')} />
          )}
        </Field>
        <Field label="Khổ giấy">
          {(id) => (
            <Select id={id} value={f.paperWidth} onChange={set('paperWidth')}>
              <option value="80">80mm</option>
              <option value="58">58mm</option>
            </Select>
          )}
        </Field>
        {printer && (
          <div className="flex items-end">
            <Switch
              checked={f.active}
              onChange={(v) => setF((x) => ({ ...x, active: v }))}
              label="Đang dùng"
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
