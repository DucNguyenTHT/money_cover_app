import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import type { OptionGroupDto } from '@ketoan/api/contracts';
import { PageHeader } from '@/components/PageHeader';
import { IngredientPicker, useIngredients } from '@/components/IngredientPicker';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, Card, EmptyState, Segmented, Switch } from '@/components/ui/controls';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { FormError } from '@/auth/AuthCard';
import { client, errorMessage, ok } from '@/lib/api-client';
import { money, parseMoney } from '@/lib/format';

interface OptionForm {
  key: number;
  id: number | null;
  name: string;
  price: string;
  recipeFactor: string;
  isDefault: boolean;
  active: boolean;
  ingredients: { key: number; ingredientId: number | null; qty: string }[];
  open: boolean;
}
interface GroupForm {
  name: string;
  multi: boolean;
  required: boolean;
  maxSelect: string;
  sort: string;
  active: boolean;
  options: OptionForm[];
}

let k = 0;
const newOption = (name = '', price = '0', extra: Partial<OptionForm> = {}): OptionForm => ({
  key: ++k,
  id: null,
  name,
  price,
  recipeFactor: '1',
  isDefault: false,
  active: true,
  ingredients: [],
  open: false,
  ...extra,
});

/** Ready-made starting points: the three kinds of options most eateries need. */
const TEMPLATES: { label: string; form: () => GroupForm }[] = [
  {
    label: 'Size',
    form: () => ({
      name: 'Size',
      multi: false,
      required: true,
      maxSelect: '',
      sort: '1',
      active: true,
      options: [
        newOption('Nhỏ', '0', { recipeFactor: '0.8' }),
        newOption('Vừa', '0', { isDefault: true }),
        newOption('Lớn', '10000', { recipeFactor: '1.5' }),
      ],
    }),
  },
  {
    label: 'Thêm topping',
    form: () => ({
      name: 'Thêm',
      multi: true,
      required: false,
      maxSelect: '',
      sort: '2',
      active: true,
      options: [newOption('Trứng', '5000'), newOption('Thịt', '15000'), newOption('Quẩy', '3000')],
    }),
  },
  {
    label: 'Yêu cầu',
    form: () => ({
      name: 'Yêu cầu',
      multi: true,
      required: false,
      maxSelect: '',
      sort: '3',
      active: true,
      options: [newOption('Ít cay'), newOption('Không hành'), newOption('Nhiều nước')],
    }),
  },
];

const fromDto = (g: OptionGroupDto): GroupForm => ({
  name: g.name,
  multi: g.multi,
  required: g.required,
  maxSelect: g.maxSelect ? String(g.maxSelect) : '',
  sort: String(g.sort),
  active: g.active,
  options: g.options.map((o) =>
    newOption(o.name, o.price, {
      id: o.id,
      recipeFactor: o.recipeFactor,
      isDefault: o.isDefault,
      active: o.active,
      ingredients: o.ingredients.map((i) => ({ key: ++k, ingredientId: i.ingredientId, qty: i.qty })),
    }),
  ),
});

const typeLabel = (g: { multi: boolean; required: boolean; maxSelect: number | null }) =>
  g.multi
    ? g.maxSelect
      ? `Chọn tối đa ${g.maxSelect}`
      : 'Chọn nhiều'
    : g.required
      ? 'Chọn 1, bắt buộc'
      : 'Chọn 1';

export function OptionGroupsPage() {
  const groups = useQuery({
    queryKey: ['option-groups'],
    queryFn: async () => ok(await client.menu.listOptionGroups()),
  });
  const [editing, setEditing] = useState<{ id: number | null; form: GroupForm } | null>(null);

  return (
    <div>
      <PageHeader
        title="Tuỳ chọn món"
        subtitle="Size, topping, yêu cầu — tạo một lần, gắn cho nhiều món ở Món & định mức → tab Tuỳ chọn"
        actions={
          <>
            {TEMPLATES.map((t) => (
              <Button key={t.label} onClick={() => setEditing({ id: null, form: t.form() })}>
                Mẫu: {t.label}
              </Button>
            ))}
            <Button
              variant="primary"
              icon={<Plus size={16} />}
              onClick={() =>
                setEditing({
                  id: null,
                  form: {
                    name: '',
                    multi: false,
                    required: false,
                    maxSelect: '',
                    sort: '0',
                    active: true,
                    options: [newOption()],
                  },
                })
              }
            >
              Thêm nhóm
            </Button>
          </>
        }
      />
      {groups.data && groups.data.length === 0 && (
        <Card>
          <EmptyState
            title="Chưa có nhóm tuỳ chọn"
            hint='Bấm "Mẫu: Size", "Mẫu: Thêm topping" hoặc "Mẫu: Yêu cầu" để bắt đầu nhanh.'
          />
        </Card>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        {groups.data?.map((g) => (
          <Card key={g.id} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="font-semibold text-ink-strong">
                  {g.name} {!g.active && <Badge>Ngừng dùng</Badge>}
                </h2>
                <p className="text-[13px] text-muted">
                  {typeLabel(g)} · dùng cho {g.dishCount} món
                </p>
              </div>
              <IconButton
                label={`Sửa ${g.name}`}
                size={34}
                onClick={() => setEditing({ id: g.id, form: fromDto(g) })}
              >
                <Pencil size={16} />
              </IconButton>
            </div>
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {g.options.map((o) => (
                <li
                  key={o.id}
                  className={`rounded-full border px-3 py-1 text-[13px] ${o.active ? 'border-line' : 'border-dashed border-field text-faint line-through'}`}
                >
                  {o.name}
                  {Number(o.price) > 0 && <span className="num text-muted"> +{money(o.price)}</span>}
                  {Number(o.recipeFactor) !== 1 && (
                    <span className="num text-muted"> · ×{o.recipeFactor.replace('.', ',')}</span>
                  )}
                  {o.isDefault && <span className="text-primary-ink"> · chọn sẵn</span>}
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
      {editing && <GroupEditor id={editing.id} initial={editing.form} onClose={() => setEditing(null)} />}
    </div>
  );
}

function GroupEditor({
  id,
  initial,
  onClose,
}: {
  id: number | null;
  initial: GroupForm;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: ingredients } = useIngredients();
  const [f, setF] = useState(initial);
  const setOpt = (key: number, p: Partial<OptionForm>) =>
    setF((x) => ({ ...x, options: x.options.map((o) => (o.key === key ? { ...o, ...p } : o)) }));

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: f.name,
        multi: f.multi,
        required: f.required,
        maxSelect: f.multi && Number(f.maxSelect) > 0 ? Number(f.maxSelect) : null,
        sort: Number(f.sort) || 0,
        active: f.active,
        options: f.options.map((o, i) => ({
          id: o.id,
          name: o.name,
          price: String(Number.isNaN(parseMoney(o.price)) ? 0 : parseMoney(o.price)),
          recipeFactor: o.recipeFactor.replace(',', '.') || '1',
          isDefault: o.isDefault,
          active: o.active,
          sort: i,
          ingredients: o.ingredients
            .filter((x) => x.ingredientId && Number(x.qty.replace(',', '.')) > 0)
            .map((x) => ({ ingredientId: x.ingredientId!, qty: x.qty.replace(',', '.') })),
        })),
      };
      return id === null
        ? ok(await client.menu.createOptionGroup({ body }))
        : ok(await client.menu.updateOptionGroup({ params: { id }, body }));
    },
    onSuccess: () => {
      toast('Đã lưu nhóm tuỳ chọn');
      qc.invalidateQueries({ queryKey: ['option-groups'] });
      qc.invalidateQueries({ queryKey: ['pos', 'option-groups'] });
      onClose();
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={id === null ? 'Thêm nhóm tuỳ chọn' : `Sửa: ${initial.name}`}
      width={820}
      footer={
        <>
          <Button onClick={onClose}>Huỷ bỏ</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Field label="Tên nhóm">
            {(fid) => (
              <Input
                id={fid}
                value={f.name}
                placeholder="VD: Size, Thêm, Yêu cầu"
                onChange={(e) => setF({ ...f, name: e.target.value })}
              />
            )}
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">Cách chọn</span>
            <Segmented
              label="Cách chọn"
              value={f.multi ? 'multi' : 'one'}
              onChange={(v) => setF({ ...f, multi: v === 'multi' })}
              options={[
                { value: 'one', label: 'Chọn 1 (size)' },
                { value: 'multi', label: 'Chọn nhiều (topping)' },
              ]}
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Switch
            checked={f.required}
            onChange={(v) => setF({ ...f, required: v })}
            label="Bắt buộc chọn"
            description="Không có lựa chọn chọn sẵn thì POS mở bảng chọn"
          />
          {f.multi ? (
            <Field label="Chọn tối đa" hint="Để trống = không giới hạn">
              {(fid, d) => (
                <Input
                  id={fid}
                  aria-describedby={d}
                  inputMode="numeric"
                  value={f.maxSelect}
                  onChange={(e) => setF({ ...f, maxSelect: e.target.value.replace(/\D/g, '') })}
                />
              )}
            </Field>
          ) : (
            <span />
          )}
          <Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Đang dùng" />
        </div>

        <div className="overflow-hidden rounded-card border border-line">
          <div className="hidden grid-cols-[minmax(0,1fr)_120px_100px_90px_90px_40px] gap-2 bg-primary-soft px-3 py-2 text-[13px] font-semibold md:grid">
            <span>Tuỳ chọn</span>
            <span className="text-right">Cộng thêm (đ)</span>
            <span className="text-right" title="Nhân toàn bộ định mức món, vd Size lớn 1,5">
              × định mức
            </span>
            <span className="text-center">Chọn sẵn</span>
            <span className="text-center">Đang dùng</span>
            <span />
          </div>
          {f.options.map((o) => (
            <Fragment key={o.key}>
              <div className="grid grid-cols-2 items-center gap-2 border-t border-line px-3 py-2 first:border-t-0 md:grid-cols-[minmax(0,1fr)_120px_100px_90px_90px_40px]">
                <div className="col-span-2 flex items-center gap-1 md:col-span-1">
                  <IconButton
                    label={o.open ? 'Ẩn nguyên liệu' : 'Nguyên liệu trừ thêm'}
                    size={30}
                    onClick={() => setOpt(o.key, { open: !o.open })}
                  >
                    {o.open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  </IconButton>
                  <Input
                    aria-label="Tên tuỳ chọn"
                    value={o.name}
                    onChange={(e) => setOpt(o.key, { name: e.target.value })}
                  />
                </div>
                {/* Phones have no column headers: a small caption above each box. */}
                <span className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted md:hidden">Cộng thêm (đ)</span>
                  <Input
                    aria-label="Tiền cộng thêm"
                    inputMode="numeric"
                    className="num text-right"
                    value={o.price === '0' ? '' : money(o.price)}
                    placeholder="0"
                    onChange={(e) => setOpt(o.key, { price: e.target.value.replace(/\D/g, '') || '0' })}
                  />
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted md:hidden">× định mức</span>
                  <Input
                    aria-label="Hệ số định mức"
                    inputMode="decimal"
                    className="num text-right"
                    value={o.recipeFactor.replace('.', ',')}
                    onChange={(e) => setOpt(o.key, { recipeFactor: e.target.value.replace(',', '.') })}
                  />
                </span>
                <label className="flex items-center justify-center gap-1.5 text-[13px]">
                  <input
                    type={f.multi ? 'checkbox' : 'radio'}
                    name="default-option"
                    className="size-4 accent-primary"
                    checked={o.isDefault}
                    onChange={(e) =>
                      setF((x) => ({
                        ...x,
                        options: x.options.map((y) =>
                          y.key === o.key
                            ? { ...y, isDefault: e.target.checked }
                            : f.multi
                              ? y
                              : { ...y, isDefault: false },
                        ),
                      }))
                    }
                  />
                  <span className="md:hidden">Chọn sẵn</span>
                </label>
                <label className="flex items-center justify-center gap-1.5 text-[13px]">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={o.active}
                    onChange={(e) => setOpt(o.key, { active: e.target.checked })}
                  />
                  <span className="md:hidden">Đang dùng</span>
                </label>
                <div className="flex justify-end">
                  {f.options.length > 1 && (
                    <IconButton
                      label="Bỏ tuỳ chọn"
                      size={30}
                      onClick={() => setF({ ...f, options: f.options.filter((x) => x.key !== o.key) })}
                    >
                      <Trash2 size={15} />
                    </IconButton>
                  )}
                </div>
              </div>
              {o.open && (
                <div className="flex flex-col gap-2 border-t border-dashed border-line bg-total-row px-3 py-2 md:pl-12">
                  <p className="text-xs text-muted">
                    Nguyên liệu trừ thêm mỗi phần khi chọn "{o.name || 'tuỳ chọn này'}" (vd Thêm trứng → 1 quả
                    trứng).
                  </p>
                  {o.ingredients.map((x) => {
                    const ing = ingredients?.find((i) => i.id === x.ingredientId);
                    const setIng = (p: Partial<typeof x>) =>
                      setOpt(o.key, {
                        ingredients: o.ingredients.map((y) => (y.key === x.key ? { ...y, ...p } : y)),
                      });
                    return (
                      <div
                        key={x.key}
                        className="grid grid-cols-[minmax(0,1fr)_120px_34px] items-center gap-2"
                      >
                        <IngredientPicker
                          value={x.ingredientId}
                          onChange={(i) => setIng({ ingredientId: i.id })}
                        />
                        <div className="flex items-center gap-1.5">
                          <Input
                            aria-label="Số lượng"
                            inputMode="decimal"
                            className="num text-right"
                            value={x.qty}
                            onChange={(e) => setIng({ qty: e.target.value })}
                          />
                          <span className="w-8 shrink-0 text-[13px] text-muted">{ing?.recipeUnit ?? ''}</span>
                        </div>
                        <IconButton
                          label="Xoá nguyên liệu"
                          size={30}
                          onClick={() =>
                            setOpt(o.key, { ingredients: o.ingredients.filter((y) => y.key !== x.key) })
                          }
                        >
                          <Trash2 size={14} />
                        </IconButton>
                      </div>
                    );
                  })}
                  <div>
                    <Button
                      size="sm"
                      variant="tonal"
                      icon={<Plus size={14} />}
                      onClick={() =>
                        setOpt(o.key, {
                          ingredients: [...o.ingredients, { key: ++k, ingredientId: null, qty: '' }],
                        })
                      }
                    >
                      Thêm nguyên liệu
                    </Button>
                  </div>
                </div>
              )}
            </Fragment>
          ))}
          <div className="border-t border-line bg-total-row px-3 py-2">
            <Button
              size="sm"
              variant="tonal"
              icon={<Plus size={15} />}
              onClick={() => setF({ ...f, options: [...f.options, newOption()] })}
            >
              Thêm tuỳ chọn
            </Button>
          </div>
        </div>
        <p className="text-xs text-faint">
          "× định mức" nhân toàn bộ nguyên liệu của món (bao bì giữ nguyên), dùng cho size: Lớn 1,5 · Nhỏ 0,8.
          Bỏ một tuỳ chọn đã từng bán thì nó chỉ bị ẩn, đơn cũ vẫn giữ nguyên.
        </p>
        <FormError message={save.error ? errorMessage(save.error) : null} />
      </div>
    </Dialog>
  );
}
