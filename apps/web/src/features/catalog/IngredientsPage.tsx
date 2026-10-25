import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Pencil, Plus } from 'lucide-react';
import type { IngredientDto } from '@ketoan/api/contracts';
import { PageHeader } from '@/components/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, Card, EmptyState, Segmented, Select, Switch } from '@/components/ui/controls';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { SearchInput } from '@/components/ui/SearchInput';
import { FormError } from '@/auth/AuthCard';
import { client, errorMessage, ok } from '@/lib/api-client';
import { qty } from '@/lib/format';

type Filter = 'active' | 'all' | 'inactive';

export function IngredientsPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('active');
  const [editing, setEditing] = useState<IngredientDto | 'new' | null>(null);

  const list = useQuery({
    queryKey: ['ingredients'],
    queryFn: async () => ok(await client.catalog.listIngredients({ query: {} })),
  });

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (list.data ?? []).filter(
      (i) =>
        (filter === 'all' || (filter === 'active') === i.active) &&
        (!term || i.name.toLowerCase().includes(term) || i.code.toLowerCase().includes(term)),
    );
  }, [list.data, q, filter]);

  const columns: Column<IngredientDto>[] = [
    {
      key: 'name',
      header: 'Tên nguyên liệu',
      cell: (i) => (
        <span className="flex items-center gap-2">
          {i.name}
          {i.kind === 'PACKAGING' && <Badge tone="primary">Bao bì</Badge>}
          {i.kind === 'SEMI' && <Badge tone="warn">Bán thành phẩm</Badge>}
          {!i.active && <Badge>Ngừng dùng</Badge>}
        </span>
      ),
    },
    { key: 'code', header: 'Mã', cell: (i) => <span className="text-muted">{i.code}</span> },
    { key: 'category', header: 'Nhóm', cell: (i) => i.category ?? '—', secondary: true },
    { key: 'unit', header: 'Đơn vị kho', cell: (i) => i.unit },
    {
      key: 'recipe',
      header: 'Đơn vị định mức',
      cell: (i) =>
        i.recipeUnit === i.unit
          ? i.recipeUnit
          : `${i.recipeUnit} (1 ${i.unit} = ${qty(i.recipeFactor)} ${i.recipeUnit})`,
    },
    {
      key: 'purchase',
      header: 'Đơn vị mua',
      secondary: true,
      cell: (i) => (i.purchaseUnit ? `${i.purchaseUnit} (= ${qty(i.purchaseFactor)} ${i.unit})` : '—'),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Nguyên liệu"
        subtitle="Nguyên liệu và bao bì dùng trong định mức món, phiếu nhập, kiểm kê"
        actions={
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditing('new')}>
            Thêm nguyên liệu
          </Button>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <SearchInput
            className="w-full max-w-xs"
            aria-label="Tìm nguyên liệu"
            placeholder="Tìm theo tên hoặc mã"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Segmented
            label="Lọc trạng thái"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'active', label: 'Đang dùng' },
              { value: 'inactive', label: 'Ngừng dùng' },
              { value: 'all', label: 'Tất cả' },
            ]}
          />
          <span className="ml-auto text-[13px] text-muted">{rows.length} nguyên liệu</span>
        </div>
        <DataTable
          rows={rows}
          loading={list.isLoading}
          columns={columns}
          rowKey={(i) => i.id}
          onRowClick={(i) => setEditing(i)}
          empty={
            <EmptyState
              title={list.data?.length ? 'Không có nguyên liệu khớp bộ lọc' : 'Chưa có nguyên liệu'}
              hint="Thêm từng nguyên liệu, hoặc nhập cả danh sách từ file Excel (sẽ có ở bước sau)."
              action={
                <Button variant="tonal" icon={<Plus size={16} />} onClick={() => setEditing('new')}>
                  Thêm nguyên liệu
                </Button>
              }
            />
          }
          actions={(i) => (
            <IconButton label="Sửa" size={34} onClick={() => setEditing(i)}>
              <Pencil size={16} />
            </IconButton>
          )}
        />
      </Card>
      {editing && (
        <IngredientForm
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => qc.invalidateQueries({ queryKey: ['ingredients'] })}
        />
      )}
    </div>
  );
}

type FormValues = Omit<IngredientDto, 'id' | 'purchaseUnit' | 'category' | 'minStock'> & {
  purchaseUnit: string;
  category: string;
  minStock: string;
};

function IngredientForm({
  item,
  onClose,
  onSaved,
}: {
  item: IngredientDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const { register, handleSubmit, watch, setValue } = useForm<FormValues>({
    defaultValues: item
      ? {
          ...item,
          purchaseUnit: item.purchaseUnit ?? '',
          category: item.category ?? '',
          minStock: item.minStock ?? '',
        }
      : {
          code: '',
          name: '',
          kind: 'INGREDIENT',
          unit: 'kg',
          recipeUnit: 'g',
          recipeFactor: '1000',
          purchaseUnit: '',
          purchaseFactor: '1',
          category: '',
          active: true,
          minStock: '',
        },
  });
  const v = watch();
  // Stock and recipes are stored in these units: they cannot change once used.
  const locked = !!item?.unitsLocked;

  const save = useMutation({
    mutationFn: async (f: FormValues) => {
      const body = {
        ...f,
        purchaseUnit: f.purchaseUnit.trim() || null,
        category: f.category.trim() || null,
        minStock: f.minStock.trim() ? f.minStock.trim().replace(',', '.') : null,
      };
      return item
        ? ok(await client.catalog.updateIngredient({ params: { id: item.id }, body }))
        : ok(await client.catalog.createIngredient({ body }));
    },
    onSuccess: () => {
      toast(item ? 'Đã lưu nguyên liệu' : 'Đã thêm nguyên liệu');
      onSaved();
      onClose();
    },
  });

  const submit = handleSubmit((f) => save.mutate(f));

  return (
    <Dialog
      open
      onClose={onClose}
      title={item ? `Sửa: ${item.name}` : 'Thêm nguyên liệu'}
      width={600}
      footer={
        <>
          <Button onClick={onClose}>Huỷ bỏ</Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            Lưu
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Tên nguyên liệu">{(id) => <Input id={id} {...register('name')} />}</Field>
        <Field label="Mã">{(id) => <Input id={id} {...register('code')} placeholder="VD: NL001" />}</Field>
        <Field label="Loại">
          {(id) => (
            <Select id={id} {...register('kind')}>
              <option value="INGREDIENT">Nguyên liệu</option>
              <option value="PACKAGING">Bao bì / đồ dùng 1 lần</option>
              <option value="SEMI">Bán thành phẩm (nước dùng, sốt… tự nấu)</option>
            </Select>
          )}
        </Field>
        <Field label="Nhóm" hint="VD: Thịt, Rau, Gia vị">
          {(id, d) => <Input id={id} aria-describedby={d} {...register('category')} />}
        </Field>

        <fieldset className="grid gap-3 rounded-card border border-line p-3 sm:col-span-2 sm:grid-cols-3">
          <legend className="px-1 text-[13px] font-semibold text-ink-strong">Đơn vị</legend>
          {locked && (
            <p className="text-xs text-muted sm:col-span-3">
              Đã có tồn kho hoặc định mức nên không đổi được đơn vị kho, đơn vị định mức và hệ số quy đổi. Cần
              đơn vị khác thì tạo nguyên liệu mới.
            </p>
          )}
          <Field label="Đơn vị kho" hint="Đơn vị tồn kho & giá vốn">
            {(id, d) => <Input id={id} aria-describedby={d} readOnly={locked} {...register('unit')} />}
          </Field>
          <Field label="Đơn vị định mức" hint="Dùng khi khai báo món">
            {(id, d) => <Input id={id} aria-describedby={d} readOnly={locked} {...register('recipeUnit')} />}
          </Field>
          <Field label={`1 ${v.unit || '…'} = ? ${v.recipeUnit || '…'}`}>
            {(id) => (
              <Input
                id={id}
                inputMode="decimal"
                className="num text-right"
                readOnly={locked}
                {...register('recipeFactor')}
              />
            )}
          </Field>
          <Field label="Đơn vị mua (tuỳ chọn)" hint="VD: thùng, bao">
            {(id, d) => <Input id={id} aria-describedby={d} {...register('purchaseUnit')} />}
          </Field>
          <Field label={`1 ${v.purchaseUnit || 'đơn vị mua'} = ? ${v.unit || '…'}`}>
            {(id) => (
              <Input
                id={id}
                inputMode="decimal"
                className="num text-right"
                disabled={!v.purchaseUnit}
                {...register('purchaseFactor')}
              />
            )}
          </Field>
        </fieldset>

        <Field
          label={`Tồn tối thiểu (${v.unit || 'đơn vị kho'})`}
          hint='Dưới mức này là "sắp hết" và có trong Kho → Cần nhập hàng. Để trống = không nhắc.'
        >
          {(id, d) => (
            <Input
              id={id}
              aria-describedby={d}
              inputMode="decimal"
              className="num text-right"
              {...register('minStock')}
            />
          )}
        </Field>

        {item && (
          <div className="sm:col-span-2">
            <Switch
              checked={v.active}
              onChange={(x) => setValue('active', x)}
              label="Đang dùng"
              description="Tắt khi không còn dùng; dữ liệu cũ vẫn giữ"
            />
          </div>
        )}
        <div className="sm:col-span-2">
          <FormError message={save.error ? errorMessage(save.error) : null} />
        </div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
