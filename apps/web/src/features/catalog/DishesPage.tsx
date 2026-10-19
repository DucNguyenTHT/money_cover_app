import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calculator, Pencil, Plus, Tags, Trash2 } from 'lucide-react';
import type { CategoryDto, DishDetail, DishDto, PricingRow } from '@ketoan/api/contracts';
import {
  TAX_GROUPS,
  TAX_GROUP_INFO,
  type PriceType,
  type RecipeScope,
  type TaxGroup,
} from '@ketoan/api/domain';
import { PageHeader } from '@/components/PageHeader';

import { IngredientPicker, useIngredients } from '@/components/IngredientPicker';
import { ReasonDialog } from '@/components/ReasonDialog';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, Card, EmptyState, Segmented, Select, Switch } from '@/components/ui/controls';
import { DataTable } from '@/components/ui/DataTable';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { SearchInput } from '@/components/ui/SearchInput';
import { FormError } from '@/auth/AuthCard';
import { client, errorMessage, ok } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { dateVi, money, parseMoney, parseQty } from '@/lib/format';
import { useBusinessToday } from '@/lib/business-date';
import { priceTypeLabel, useDeliveryApps } from '@/lib/delivery-apps';

type Row = DishDto & { cost?: PricingRow };

export function DishesPage() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<number | 'all'>('all');
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [showCats, setShowCats] = useState(false);
  const dishes = useQuery({
    queryKey: ['dishes'],
    queryFn: async () => ok(await client.menu.listDishes({ query: {} })),
  });
  const cats = useQuery({
    queryKey: ['dish-categories'],
    queryFn: async () => ok(await client.menu.listCategories()),
  });
  const pricing = useQuery({
    queryKey: ['pricing'],
    queryFn: async () => ok(await client.pricing.list({ query: {} })),
  });

  const rows: Row[] = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (dishes.data ?? [])
      .filter(
        (d) =>
          (cat === 'all' || d.categoryId === cat) &&
          (!t || d.name.toLowerCase().includes(t) || d.code.toLowerCase().includes(t)),
      )
      .map((d) => ({ ...d, cost: pricing.data?.rows.find((r) => r.dishId === d.id) }));
  }, [dishes.data, pricing.data, q, cat]);

  return (
    <div>
      <PageHeader
        title="Món & định mức"
        subtitle="Giá vốn tính theo định mức hiện hành × giá nhập gần nhất"
        actions={
          <>
            <Button icon={<Tags size={16} />} onClick={() => setShowCats(true)}>
              Nhóm món
            </Button>
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditing('new')}>
              Thêm món
            </Button>
          </>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <SearchInput
            className="w-full max-w-xs"
            aria-label="Tìm món"
            placeholder="Tìm món"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Select
            aria-label="Nhóm món"
            className="w-48"
            value={String(cat)}
            onChange={(e) => setCat(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          >
            <option value="all">Tất cả nhóm</option>
            {cats.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <span className="ml-auto text-[13px] text-muted">{rows.length} món</span>
        </div>
        <DataTable<Row>
          rows={rows}
          loading={dishes.isLoading}
          rowKey={(r) => r.id}
          onRowClick={(r) => setEditing(r.id)}
          empty={
            <EmptyState
              title="Chưa có món"
              hint="Thêm món, hoặc nhập cả thực đơn từ Excel (Hệ thống → Nhập dữ liệu Excel)."
            />
          }
          columns={[
            {
              key: 'name',
              header: 'Món',
              cell: (r) => (
                <span className="flex flex-wrap items-center gap-1.5">
                  {r.name}
                  {!r.active && <Badge>Ngừng bán</Badge>}
                  {r.soldOut && <Badge tone="warn">Hết món</Badge>}
                  {!r.hasRecipe && <Badge tone="warn">Chưa có định mức</Badge>}
                  {r.cost?.alert === 'LOSS' && <Badge tone="bad">Đang lỗ</Badge>}
                  {r.cost?.alert === 'OVER_TARGET' && <Badge tone="warn">Vượt % mục tiêu</Badge>}
                </span>
              ),
            },
            { key: 'cat', header: 'Nhóm', secondary: true, cell: (r) => r.categoryName },
            {
              key: 'store',
              header: 'Giá tại quán',
              align: 'right',
              cell: (r) => <span className="num">{r.storePrice ? money(r.storePrice) : '—'}</span>,
            },
            {
              key: 'app',
              header: 'Giá app',
              align: 'right',
              secondary: true,
              cell: (r) => (
                <span className="num">
                  {r.appPrice ? money(r.appPrice) : '—'}
                  {r.appPrices.length > 0 && (
                    <span className="block text-xs font-normal text-faint">
                      +{r.appPrices.length} app giá riêng
                    </span>
                  )}
                </span>
              ),
            },
            {
              key: 'cost',
              header: 'Giá vốn',
              align: 'right',
              cell: (r) => (
                <span className="num">
                  {r.cost?.hasRecipe ? money(r.cost.channels.DINE_IN.directCost) : '—'}
                </span>
              ),
            },
            {
              key: 'fc',
              header: '% NL / giá',
              align: 'right',
              cell: (r) => {
                const fc = r.cost?.channels.DINE_IN.foodCostPct;
                if (!r.cost?.hasRecipe || fc == null) return '—';
                const over = Number(fc) > Number(r.cost.targetPct);
                return (
                  <span className={cn('num', over && 'font-semibold text-warn')}>
                    {fc.replace('.', ',')}%
                  </span>
                );
              },
            },
            {
              key: 'profit',
              header: 'Lãi / phần',
              align: 'right',
              cell: (r) => {
                const p = r.cost?.channels.DINE_IN.profit;
                if (!r.cost?.hasRecipe || p == null) return '—';
                return <b className={cn('num', Number(p) < 0 && 'text-bad')}>{money(p)}</b>;
              },
            },
          ]}
          actions={(r) => (
            <>
              <Link
                to={`/admin/menu/cost-sheet?dish=${r.id}`}
                aria-label="Bảng tính giá"
                title="Bảng tính giá"
                className="inline-flex size-[34px] items-center justify-center rounded-ctl border border-field bg-white text-muted hover:bg-[#f8fafc]"
              >
                <Calculator size={16} />
              </Link>
              <IconButton label="Sửa" size={34} onClick={() => setEditing(r.id)}>
                <Pencil size={16} />
              </IconButton>
            </>
          )}
        />
      </Card>
      {editing !== null && (
        <DishEditor
          id={editing === 'new' ? null : editing}
          categories={cats.data ?? []}
          onClose={() => setEditing(null)}
        />
      )}
      {showCats && <CategoriesDialog categories={cats.data ?? []} onClose={() => setShowCats(false)} />}
    </div>
  );
}

function useInvalidateMenu() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['dishes'] });
    qc.invalidateQueries({ queryKey: ['pricing'] });
    qc.invalidateQueries({ queryKey: ['dish'] });
    qc.invalidateQueries({ queryKey: ['dish-categories'] });
    qc.invalidateQueries({ queryKey: ['option-groups'] });
    qc.invalidateQueries({ queryKey: ['pos', 'menu'] });
  };
}

type Tab = 'info' | 'prices' | 'recipe' | 'options';

function DishEditor({
  id,
  categories,
  onClose,
}: {
  id: number | null;
  categories: CategoryDto[];
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('info');
  const [dishId, setDishId] = useState(id);
  const detail = useQuery({
    queryKey: ['dish', dishId],
    enabled: dishId !== null,
    queryFn: async () => ok(await client.menu.getDish({ params: { id: dishId! } })),
  });
  const d = detail.data;
  return (
    <Dialog open onClose={onClose} title={dishId === null ? 'Thêm món' : (d?.name ?? 'Món')} width={860}>
      {dishId !== null && (
        <div className="mb-4">
          <Segmented
            label="Mục"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'info', label: 'Thông tin' },
              { value: 'prices', label: 'Giá bán' },
              { value: 'recipe', label: 'Định mức' },
              { value: 'options', label: 'Tuỳ chọn' },
            ]}
          />
        </div>
      )}
      {dishId === null && (
        <InfoTab
          dish={null}
          categories={categories}
          onCreated={(newId) => {
            setDishId(newId);
            setTab('recipe');
          }}
        />
      )}
      {d && tab === 'info' && <InfoTab dish={d} categories={categories} />}
      {d && tab === 'prices' && <PricesTab dish={d} />}
      {d && tab === 'recipe' && <RecipeTab dish={d} />}
      {d && tab === 'options' && <OptionsTab dish={d} />}
    </Dialog>
  );
}

function InfoTab({
  dish,
  categories,
  onCreated,
}: {
  dish: DishDetail | null;
  categories: CategoryDto[];
  onCreated?: (id: number) => void;
}) {
  const toast = useToast();
  const invalidate = useInvalidateMenu();
  const [f, setF] = useState({
    code: dish?.code ?? '',
    name: dish?.name ?? '',
    categoryId: dish?.categoryId ?? categories[0]?.id ?? 0,
    sort: String(dish?.sort ?? 0),
    active: dish?.active ?? true,
    storePrice: '',
    appPrice: '',
  });
  const save = useMutation({
    mutationFn: async () => {
      const base = {
        code: f.code,
        name: f.name,
        categoryId: Number(f.categoryId),
        sort: Number(f.sort) || 0,
        active: f.active,
      };
      if (dish) return ok(await client.menu.updateDish({ params: { id: dish.id }, body: base }));
      const sp = parseMoney(f.storePrice);
      const ap = parseMoney(f.appPrice);
      return ok(
        await client.menu.createDish({
          body: {
            ...base,
            storePrice: Number.isNaN(sp) ? null : String(sp),
            appPrice: Number.isNaN(ap) ? null : String(ap),
          },
        }),
      );
    },
    onSuccess: (d) => {
      toast(dish ? 'Đã lưu món' : 'Đã thêm món — khai báo định mức tiếp theo');
      invalidate();
      onCreated?.(d.id);
    },
  });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Tên món">
        {(id) => <Input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}
      </Field>
      <Field label="Mã món">
        {(id) => (
          <Input
            id={id}
            value={f.code}
            onChange={(e) => setF({ ...f, code: e.target.value })}
            placeholder="VD: PHO01"
          />
        )}
      </Field>
      <Field
        label="Nhóm món"
        hint={categories.length === 0 ? 'Tạo nhóm món trước (nút "Nhóm món")' : undefined}
      >
        {(id, dd) => (
          <Select
            id={id}
            aria-describedby={dd}
            value={String(f.categoryId)}
            onChange={(e) => setF({ ...f, categoryId: Number(e.target.value) })}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.station === 'BAR' ? 'Bar' : 'Bếp'})
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Thứ tự trên thực đơn">
        {(id) => (
          <Input
            id={id}
            inputMode="numeric"
            value={f.sort}
            onChange={(e) => setF({ ...f, sort: e.target.value })}
          />
        )}
      </Field>
      {!dish && (
        <>
          <Field label="Giá tại quán / mang về">
            {(id) => (
              <Input
                id={id}
                inputMode="numeric"
                className="num text-right"
                value={f.storePrice}
                onChange={(e) => setF({ ...f, storePrice: e.target.value })}
              />
            )}
          </Field>
          <Field
            label="Giá trên app (chung)"
            hint="Để trống = dùng giá tại quán. Giá riêng từng app: tab Giá bán"
          >
            {(id, dd) => (
              <Input
                id={id}
                aria-describedby={dd}
                inputMode="numeric"
                className="num text-right"
                value={f.appPrice}
                onChange={(e) => setF({ ...f, appPrice: e.target.value })}
              />
            )}
          </Field>
        </>
      )}
      {dish && (
        <div className="sm:col-span-2">
          <Switch
            checked={f.active}
            onChange={(v) => setF({ ...f, active: v })}
            label="Đang bán"
            description="Tắt để ẩn khỏi thực đơn POS (vẫn giữ lịch sử)"
          />
        </div>
      )}
      <div className="flex flex-col gap-3 sm:col-span-2">
        <FormError message={save.error ? errorMessage(save.error) : null} />
        <div className="flex justify-end">
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            {dish ? 'Lưu thông tin' : 'Tạo món'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function PricesTab({ dish }: { dish: DishDetail }) {
  const toast = useToast();
  const invalidate = useInvalidateMenu();
  const apps = useDeliveryApps().data;
  const activeApps = (apps ?? []).filter((a) => a.active);
  const [type, setType] = useState<PriceType>('STORE');
  const [appId, setAppId] = useState<number | null>(null);
  const [price, setPrice] = useState('');
  const bizToday = useBusinessToday();
  const [from, setFrom] = useState(bizToday);
  const save = useMutation({
    mutationFn: async () =>
      ok(
        await client.menu.setPrice({
          params: { id: dish.id },
          body: {
            priceType: type,
            deliveryAppId: type === 'APP' ? appId : null,
            price: String(parseMoney(price)),
            effectiveFrom: from,
          },
        }),
      ),
    onSuccess: () => {
      toast('Đã áp dụng giá mới');
      setPrice('');
      invalidate();
    },
  });
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="p-4">
          <div className="text-[13px] text-muted">Giá tại quán / mang về hiện tại</div>
          <div className="mt-1 text-2xl font-bold text-ink-strong">
            {dish.storePrice ? `${money(dish.storePrice)} ₫` : '—'}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[13px] text-muted">Giá trên app hiện tại</div>
          <dl className="mt-1 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted">Giá chung</dt>
            <dd className="num text-right font-bold text-ink-strong">
              {dish.appPrice ? `${money(dish.appPrice)} ₫` : '—'}
            </dd>
            {activeApps.map((a) => {
              const own = dish.appPrices.find((p) => p.deliveryAppId === a.id);
              return (
                <Fragment key={a.id}>
                  <dt className="truncate">{a.name}</dt>
                  <dd className="num text-right">
                    {own ? (
                      <b className="text-ink-strong">{money(own.price)} ₫</b>
                    ) : (
                      <span className="text-faint">theo giá chung</span>
                    )}
                  </dd>
                </Fragment>
              );
            })}
          </dl>
        </Card>
      </div>
      <Card className="p-4">
        <h3 className="mb-3 font-semibold text-ink-strong">Áp dụng giá mới</h3>
        <div
          className={cn(
            'grid items-end gap-3',
            type === 'APP'
              ? 'sm:grid-cols-[auto_minmax(190px,1.3fr)_1fr_1fr_auto]'
              : 'sm:grid-cols-[auto_1fr_1fr_auto]',
          )}
        >
          <Segmented
            label="Loại giá"
            value={type}
            onChange={setType}
            options={[
              { value: 'STORE', label: 'Tại quán' },
              { value: 'APP', label: 'App' },
            ]}
          />
          {type === 'APP' && (
            <Field label="Cho app">
              {(id) => (
                <Select
                  id={id}
                  value={appId ?? ''}
                  onChange={(e) => setAppId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Mọi app (giá chung)</option>
                  {activeApps.map((a) => (
                    <option key={a.id} value={a.id}>
                      Chỉ {a.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field label="Giá mới">
            {(id) => (
              <Input
                id={id}
                inputMode="numeric"
                className="num text-right"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            )}
          </Field>
          <Field label="Áp dụng từ ngày">
            {(id) => <Input id={id} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}
          </Field>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={Number.isNaN(parseMoney(price))}
            onClick={() => save.mutate()}
          >
            Áp dụng
          </Button>
        </div>
        <p className="mt-2 text-xs text-faint">
          Đơn từ ngày này dùng giá mới; đơn trước đó giữ giá cũ.
          {type === 'APP' && ' App không có giá riêng thì dùng giá chung.'}
        </p>
        <div className="mt-2">
          <FormError message={save.error ? errorMessage(save.error) : null} />
        </div>
      </Card>
      <div>
        <h3 className="mb-2 font-semibold text-ink-strong">Lịch sử giá bán</h3>
        <DataTable
          rows={dish.prices}
          rowKey={(p) => p.id}
          empty={<EmptyState title="Chưa có giá" />}
          columns={[
            { key: 'from', header: 'Từ ngày', cell: (p) => dateVi(p.effectiveFrom) },
            {
              key: 'type',
              header: 'Loại',
              cell: (p) => priceTypeLabel(p, apps),
            },
            {
              key: 'price',
              header: 'Giá',
              align: 'right',
              cell: (p) => <b className="num">{money(p.price)}</b>,
            },
          ]}
        />
      </div>
    </div>
  );
}

interface RLine {
  key: number;
  ingredientId: number | null;
  qty: string;
  scope: RecipeScope;
}
let rk = 0;

function RecipeTab({ dish }: { dish: DishDetail }) {
  const toast = useToast();
  const invalidate = useInvalidateMenu();
  const { data: ingredients } = useIngredients();
  const bizToday = useBusinessToday();
  const current = dish.recipes.find((r) => r.effectiveFrom <= bizToday) ?? dish.recipes[0];
  const [versionId, setVersionId] = useState<number | 'new'>(current?.id ?? 'new');
  const version = dish.recipes.find((r) => r.id === versionId);
  const startFrom = (r = version) => ({
    from: r && !r.used ? r.effectiveFrom : bizToday,
    note: r?.note ?? '',
    lines: (r?.items ?? []).map((i) => ({
      key: ++rk,
      ingredientId: i.ingredientId,
      qty: i.qty,
      scope: i.scope,
    })) as RLine[],
  });
  const [form, setForm] = useState(() => {
    const s = startFrom();
    return {
      ...s,
      lines: s.lines.length
        ? s.lines
        : [{ key: ++rk, ingredientId: null, qty: '', scope: 'ALL' as RecipeScope }],
    };
  });
  const [askDelete, setAskDelete] = useState(false);
  const readOnly = !!version?.used && form.from === version.effectiveFrom;

  const switchVersion = (v: number | 'new') => {
    setVersionId(v);
    const r = v === 'new' ? version : dish.recipes.find((x) => x.id === v);
    const s = startFrom(r);
    setForm(v === 'new' ? { ...s, from: bizToday, note: '' } : s);
  };

  const save = useMutation({
    mutationFn: async () =>
      ok(
        await client.menu.saveRecipe({
          params: { id: dish.id },
          body: {
            effectiveFrom: form.from,
            note: form.note.trim() || null,
            items: form.lines
              .filter((l) => l.ingredientId && parseQty(l.qty) > 0)
              .map((l) => ({ ingredientId: l.ingredientId!, qty: String(parseQty(l.qty)), scope: l.scope })),
          },
        }),
      ),
    onSuccess: (d) => {
      toast('Đã lưu định mức');
      invalidate();
      const saved = d.recipes.find((r) => r.effectiveFrom === form.from);
      if (saved) setVersionId(saved.id);
    },
  });

  const setLine = (key: number, p: Partial<RLine>) =>
    setForm((f) => ({ ...f, lines: f.lines.map((l) => (l.key === key ? { ...l, ...p } : l)) }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Phiên bản định mức">
          {(id) => (
            <Select
              id={id}
              className="w-64"
              value={String(versionId)}
              onChange={(e) => switchVersion(e.target.value === 'new' ? 'new' : Number(e.target.value))}
            >
              {dish.recipes.map((r) => (
                <option key={r.id} value={r.id}>
                  Từ {dateVi(r.effectiveFrom)}
                  {r.id === current?.id ? ' (đang dùng)' : ''}
                  {r.used ? ' · đã có đơn' : ''}
                </option>
              ))}
              <option value="new">+ Phiên bản mới</option>
            </Select>
          )}
        </Field>
        <Field label="Áp dụng từ ngày">
          {(id) => (
            <Input
              id={id}
              type="date"
              className="w-44"
              value={form.from}
              onChange={(e) => setForm({ ...form, from: e.target.value })}
            />
          )}
        </Field>
      </div>
      {version?.used && (
        <p className="rounded-ctl bg-primary-soft px-3 py-2 text-[13px] text-primary-ink">
          Phiên bản này đã dùng cho đơn hàng nên không sửa được. Đổi ngày áp dụng sang ngày khác để lưu thành
          phiên bản mới.
        </p>
      )}

      <div className="overflow-hidden rounded-card border border-line">
        <div className="hidden grid-cols-[minmax(0,1fr)_140px_170px_44px] gap-2 bg-primary-soft px-3 py-2 text-[13px] font-semibold md:grid">
          <span>Nguyên liệu / bao bì</span>
          <span className="text-right">Định mức / phần</span>
          <span>Áp dụng cho</span>
          <span />
        </div>
        {form.lines.map((l) => {
          const ing = ingredients?.find((i) => i.id === l.ingredientId);
          return (
            <div
              key={l.key}
              className="grid grid-cols-2 items-center gap-2 border-t border-line px-3 py-2 first:border-t-0 md:grid-cols-[minmax(0,1fr)_140px_170px_44px] md:[&:nth-child(2)]:border-t-0"
            >
              <div className="col-span-2 md:col-span-1">
                <IngredientPicker
                  value={l.ingredientId}
                  onChange={(i) =>
                    setLine(l.key, {
                      ingredientId: i.id,
                      scope: i.kind === 'PACKAGING' ? 'TAKEAWAY_APP' : l.scope,
                    })
                  }
                />
              </div>
              <div className="flex items-center gap-1.5">
                <Input
                  disabled={readOnly}
                  aria-label="Định mức"
                  inputMode="decimal"
                  className="num text-right"
                  value={l.qty}
                  onChange={(e) => setLine(l.key, { qty: e.target.value })}
                />
                <span className="w-8 shrink-0 text-[13px] text-muted">{ing?.recipeUnit ?? ''}</span>
              </div>
              <Select
                disabled={readOnly}
                aria-label="Áp dụng cho"
                value={l.scope}
                onChange={(e) => setLine(l.key, { scope: e.target.value as RecipeScope })}
              >
                <option value="ALL">Tất cả kênh</option>
                <option value="TAKEAWAY_APP">Chỉ mang về / app</option>
              </Select>
              <div className="flex justify-end">
                {!readOnly && form.lines.length > 1 && (
                  <IconButton
                    label="Xoá dòng"
                    size={34}
                    onClick={() => setForm({ ...form, lines: form.lines.filter((x) => x.key !== l.key) })}
                  >
                    <Trash2 size={15} />
                  </IconButton>
                )}
              </div>
            </div>
          );
        })}
        {!readOnly && (
          <div className="border-t border-line bg-total-row px-3 py-2">
            <Button
              size="sm"
              variant="tonal"
              icon={<Plus size={15} />}
              onClick={() =>
                setForm({
                  ...form,
                  lines: [...form.lines, { key: ++rk, ingredientId: null, qty: '', scope: 'ALL' }],
                })
              }
            >
              Thêm nguyên liệu
            </Button>
          </div>
        )}
      </div>
      <Field label="Ghi chú">
        {(id) => (
          <Input
            id={id}
            disabled={readOnly}
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            placeholder="VD: tăng thịt từ 150g lên 200g"
          />
        )}
      </Field>
      <FormError message={save.error ? errorMessage(save.error) : null} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        {version && !version.used ? (
          <Button variant="danger" icon={<Trash2 size={16} />} onClick={() => setAskDelete(true)}>
            Xoá phiên bản
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Link
            to={`/admin/menu/cost-sheet?dish=${dish.id}`}
            className="inline-flex h-9 items-center gap-2 rounded-ctl border border-field bg-white px-3.5 text-sm font-semibold text-[#344054] shadow-[var(--shadow-btn)]"
          >
            <Calculator size={16} /> Xem bảng tính giá
          </Link>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={readOnly}
            onClick={() => save.mutate()}
          >
            Lưu định mức
          </Button>
        </div>
      </div>
      <ReasonDialog
        open={askDelete}
        danger
        title="Xoá phiên bản định mức"
        confirmLabel="Xoá"
        onClose={() => setAskDelete(false)}
        onConfirm={async (reason) => {
          ok(
            await client.menu.deleteRecipe({
              params: { id: dish.id, recipeId: version!.id },
              body: { reason },
            }),
          );
          toast('Đã xoá phiên bản');
          invalidate();
          switchVersion('new');
        }}
      />
    </div>
  );
}

function CategoriesDialog({ categories, onClose }: { categories: CategoryDto[]; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateMenu();
  const [editing, setEditing] = useState<CategoryDto | 'new' | null>(null);
  const [f, setF] = useState({
    name: '',
    target: '',
    station: 'KITCHEN' as 'KITCHEN' | 'BAR',
    taxGroup: 'PRODUCTION' as TaxGroup,
    sort: '0',
  });
  const open = (c: CategoryDto | 'new') => {
    setEditing(c);
    setF(
      c === 'new'
        ? {
            name: '',
            target: '',
            station: 'KITCHEN',
            taxGroup: 'PRODUCTION',
            sort: String(categories.length + 1),
          }
        : {
            name: c.name,
            target: c.foodCostTarget ?? '',
            station: c.station,
            taxGroup: c.taxGroup,
            sort: String(c.sort),
          },
    );
  };
  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: f.name,
        foodCostTarget: f.target.trim() ? f.target.replace(',', '.') : null,
        station: f.station,
        taxGroup: f.taxGroup,
        sort: Number(f.sort) || 0,
      };
      return editing === 'new'
        ? ok(await client.menu.createCategory({ body }))
        : ok(await client.menu.updateCategory({ params: { id: (editing as CategoryDto).id }, body }));
    },
    onSuccess: () => {
      toast('Đã lưu nhóm món');
      invalidate();
      setEditing(null);
    },
  });
  return (
    <Dialog open onClose={onClose} title="Nhóm món" width={640}>
      {editing ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tên nhóm">
            {(id) => <Input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">Gửi món tới</span>
            <Segmented
              label="Trạm"
              value={f.station}
              onChange={(v) => setF({ ...f, station: v })}
              options={[
                { value: 'KITCHEN', label: 'Bếp' },
                { value: 'BAR', label: 'Quầy bar' },
              ]}
            />
          </div>
          <Field label="% nguyên liệu / giá mục tiêu" hint="Để trống = dùng mặc định trong Cài đặt">
            {(id, d) => (
              <Input
                id={id}
                aria-describedby={d}
                inputMode="decimal"
                className="num text-right"
                value={f.target}
                onChange={(e) => setF({ ...f, target: e.target.value })}
              />
            )}
          </Field>
          <div className="sm:col-span-2">
            <Field
              label="Ngành thuế (hộ kinh doanh)"
              hint={`Thuế GTGT ${TAX_GROUP_INFO[f.taxGroup].vat}% · thuế TNCN theo doanh thu ${String(TAX_GROUP_INFO[f.taxGroup].pit).replace('.', ',')}% trên doanh thu nhóm này`}
            >
              {(id, d) => (
                <Select
                  id={id}
                  aria-describedby={d}
                  value={f.taxGroup}
                  onChange={(e) => setF({ ...f, taxGroup: e.target.value as TaxGroup })}
                >
                  {TAX_GROUPS.map((g) => (
                    <option key={g} value={g}>
                      {TAX_GROUP_INFO[g].label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Field label="Thứ tự">
            {(id) => (
              <Input
                id={id}
                inputMode="numeric"
                value={f.sort}
                onChange={(e) => setF({ ...f, sort: e.target.value })}
              />
            )}
          </Field>
          <div className="sm:col-span-2">
            <FormError message={save.error ? errorMessage(save.error) : null} />
          </div>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button onClick={() => setEditing(null)}>Quay lại</Button>
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
              Lưu nhóm
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <DataTable
            rows={categories}
            rowKey={(c) => c.id}
            onRowClick={open}
            empty={<EmptyState title="Chưa có nhóm món" />}
            columns={[
              { key: 'name', header: 'Nhóm', cell: (c) => c.name },
              { key: 'station', header: 'Trạm', cell: (c) => (c.station === 'BAR' ? 'Quầy bar' : 'Bếp') },
              {
                key: 'target',
                header: '% mục tiêu',
                align: 'right',
                cell: (c) => (c.foodCostTarget ? `${Number(c.foodCostTarget)}%` : 'Mặc định'),
              },
              {
                key: 'tax',
                header: 'Thuế GTGT (hộ KD)',
                align: 'right',
                secondary: true,
                cell: (c) => `${TAX_GROUP_INFO[c.taxGroup].vat}%`,
              },
              { key: 'count', header: 'Số món', align: 'right', cell: (c) => c.dishCount },
            ]}
          />
          <div>
            <Button variant="tonal" icon={<Plus size={16} />} onClick={() => open('new')}>
              Thêm nhóm
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/** Which option groups (size, toppings, requests) the dish uses, in the order the POS shows them. */
function OptionsTab({ dish }: { dish: DishDetail }) {
  const toast = useToast();
  const invalidate = useInvalidateMenu();
  const groups = useQuery({
    queryKey: ['option-groups'],
    queryFn: async () => ok(await client.menu.listOptionGroups()),
  });
  const [picked, setPicked] = useState<number[]>(dish.optionGroupIds);
  const save = useMutation({
    mutationFn: async () =>
      ok(await client.menu.setDishOptionGroups({ params: { id: dish.id }, body: { groupIds: picked } })),
    onSuccess: () => {
      toast('Đã lưu tuỳ chọn của món');
      invalidate();
    },
  });
  const move = (id: number, by: number) =>
    setPicked((p) => {
      const i = p.indexOf(id);
      const j = i + by;
      if (j < 0 || j >= p.length) return p;
      const next = [...p];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  const all = groups.data ?? [];
  const ordered = [
    ...picked.flatMap((id) => all.filter((g) => g.id === id)),
    ...all.filter((g) => !picked.includes(g.id)),
  ];

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-muted">
        Chọn các nhóm tuỳ chọn cho món này (size, topping, yêu cầu). Tạo / sửa nhóm ở{' '}
        <Link className="text-primary-ink underline" to="/admin/menu/options">
          Thực đơn → Tuỳ chọn món
        </Link>
        .
      </p>
      {groups.data && all.length === 0 ? (
        <EmptyState title="Chưa có nhóm tuỳ chọn nào" hint="Tạo nhóm ở Thực đơn → Tuỳ chọn món trước." />
      ) : (
        <ul className="overflow-hidden rounded-card border border-line">
          {ordered.map((g) => {
            const on = picked.includes(g.id);
            return (
              <li
                key={g.id}
                className="flex items-center gap-3 border-t border-line px-3 py-2.5 first:border-t-0"
              >
                <input
                  type="checkbox"
                  aria-label={`Dùng nhóm ${g.name}`}
                  className="size-4 accent-primary"
                  checked={on}
                  onChange={(e) =>
                    setPicked((p) => (e.target.checked ? [...p, g.id] : p.filter((x) => x !== g.id)))
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{g.name}</span> {!g.active && <Badge>Ngừng dùng</Badge>}
                  <span className="block truncate text-xs text-muted">
                    {g.options
                      .filter((o) => o.active)
                      .map((o) => (Number(o.price) > 0 ? `${o.name} +${money(o.price)}` : o.name))
                      .join(' · ')}
                  </span>
                </span>
                {on && (
                  <span className="flex gap-1">
                    <IconButton label={`Đưa ${g.name} lên`} size={30} onClick={() => move(g.id, -1)}>
                      ↑
                    </IconButton>
                    <IconButton label={`Đưa ${g.name} xuống`} size={30} onClick={() => move(g.id, 1)}>
                      ↓
                    </IconButton>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <FormError message={save.error ? errorMessage(save.error) : null} />
      <div className="flex justify-end">
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
          Lưu tuỳ chọn
        </Button>
      </div>
    </div>
  );
}
