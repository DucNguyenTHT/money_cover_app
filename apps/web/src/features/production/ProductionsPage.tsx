import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChefHat, ClipboardList, Lock, Plus, Trash2, Wand2 } from 'lucide-react';
import type { ProductionDto, SemiDto } from '@ketoan/api/contracts';
import { useAuth } from '@/auth/AuthProvider';
import { FormError } from '@/auth/AuthCard';
import { PageHeader } from '@/components/PageHeader';
import { MonthPicker, thisMonth } from '@/components/MonthPicker';
import { DateInput } from '@/components/DateInput';
import { IngredientPicker, useIngredients } from '@/components/IngredientPicker';
import { ReasonDialog } from '@/components/ReasonDialog';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, Card, EmptyState, Segmented, Select } from '@/components/ui/controls';
import { DataTable } from '@/components/ui/DataTable';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { client, errorMessage, ok } from '@/lib/api-client';
import { useBusinessDateState, useBusinessToday } from '@/lib/business-date';
import { dateVi, money, parseQty, qtyUnit } from '@/lib/format';

interface Line {
  key: number;
  ingredientId: number | null;
  qty: string;
}
let lineKey = 0;
const newLine = (ingredientId: number | null = null, qty = ''): Line => ({
  key: ++lineKey,
  ingredientId,
  qty,
});
const num = (v: string) => String(parseQty(v));

/** Kho › Chế biến: cooking semi-finished goods (broth, sauces) from ingredients, and their batch recipes. */
export function ProductionsPage() {
  const { user } = useAuth();
  const admin = user?.role === 'ADMIN';
  const [tab, setTab] = useState<'BATCHES' | 'RECIPES'>('BATCHES');
  const [month, setMonth] = useState(thisMonth());
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<ProductionDto | null>(null);
  const [editing, setEditing] = useState<SemiDto | null>(null);
  const semis = useQuery({ queryKey: ['semis'], queryFn: async () => ok(await client.production.semis()) });
  const list = useQuery({
    queryKey: ['productions', month],
    queryFn: async () => ok(await client.production.list({ query: { month } })),
  });
  const noSemi = semis.data && semis.data.length === 0;

  return (
    <div>
      <PageHeader
        title="Chế biến"
        subtitle="Nấu bán thành phẩm (nước dùng, sốt…): xuất nguyên liệu, nhập một lô thành phẩm có giá vốn theo nguyên liệu thật"
        actions={
          <Button
            variant="primary"
            icon={<Plus size={16} />}
            disabled={!!noSemi}
            onClick={() => setCreating(true)}
          >
            Ghi phiếu chế biến
          </Button>
        }
      />
      {noSemi ? (
        <Card>
          <EmptyState
            title="Chưa có bán thành phẩm"
            hint='Tạo nguyên liệu loại "Bán thành phẩm" (vd Nước dùng bò, đơn vị lít) ở Thực đơn → Nguyên liệu, rồi nhập công thức nấu một mẻ ở đây. Món dùng nước dùng theo ml trong định mức như nguyên liệu thường.'
            action={
              admin ? (
                <Link to="/admin/menu/ingredients">
                  <Button>Mở Nguyên liệu</Button>
                </Link>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
            <Segmented
              label="Xem"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'BATCHES', label: 'Phiếu chế biến' },
                { value: 'RECIPES', label: 'Bán thành phẩm & công thức' },
              ]}
            />
            {tab === 'BATCHES' && <MonthPicker value={month} onChange={setMonth} />}
          </div>
          {tab === 'BATCHES' ? (
            <DataTable<ProductionDto>
              rows={list.data}
              loading={list.isLoading}
              rowKey={(p) => p.id}
              onRowClick={setViewing}
              empty={<EmptyState title="Chưa có phiếu chế biến trong tháng" />}
              columns={[
                {
                  key: 'name',
                  header: 'Bán thành phẩm',
                  cell: (p) => (
                    <span className="flex items-center gap-2">
                      <b className="text-ink-strong">{p.name}</b>
                      {p.locked && <Lock size={13} className="text-faint" aria-label="Đã khoá sổ" />}
                    </span>
                  ),
                },
                { key: 'date', header: 'Ngày', cell: (p) => dateVi(p.date) },
                { key: 'qty', header: 'Thu được', align: 'right', cell: (p) => qtyUnit(p.qty, p.unit) },
                ...(admin
                  ? [
                      {
                        key: 'cost',
                        header: 'Giá vốn / đơn vị',
                        align: 'right' as const,
                        cell: (p: ProductionDto) => (
                          <span className="num">
                            {money(p.unitCost)}
                            <span className="block text-xs text-faint">tổng {money(p.costTotal)}</span>
                          </span>
                        ),
                      },
                    ]
                  : []),
                { key: 'by', header: 'Người ghi', secondary: true, cell: (p) => p.createdBy },
              ]}
            />
          ) : (
            <DataTable<SemiDto>
              rows={semis.data}
              loading={semis.isLoading}
              rowKey={(x) => x.ingredientId}
              columns={[
                {
                  key: 'name',
                  header: 'Bán thành phẩm',
                  cell: (x) => <b className="text-ink-strong">{x.name}</b>,
                },
                { key: 'stock', header: 'Tồn', align: 'right', cell: (x) => qtyUnit(x.onHand, x.unit) },
                {
                  key: 'recipe',
                  header: 'Công thức một mẻ',
                  cell: (x) =>
                    x.recipe ? (
                      <span className="text-[13px]">
                        {x.recipe.items.map((i) => `${qtyUnit(i.qty, i.unit)} ${i.name}`).join(' + ')} →{' '}
                        <b>{qtyUnit(x.recipe.yieldQty, x.unit)}</b>
                        <span className="block text-xs text-faint">từ {dateVi(x.recipe.effectiveFrom)}</span>
                      </span>
                    ) : (
                      <Badge tone="warn">Chưa có công thức</Badge>
                    ),
                },
                ...(admin
                  ? [
                      {
                        key: 'cost',
                        header: `Giá vốn / đơn vị`,
                        align: 'right' as const,
                        cell: (x: SemiDto) => (
                          <span className="num text-[13px]">
                            {x.theoreticalUnitCost ? money(x.theoreticalUnitCost) : '—'}
                            <span className="block text-xs text-faint">
                              {x.lastUnitCost
                                ? `mẻ gần nhất ${money(x.lastUnitCost)}`
                                : 'theo giá nhập mới nhất'}
                            </span>
                          </span>
                        ),
                      },
                    ]
                  : []),
              ]}
              actions={(x) =>
                admin ? (
                  <IconButton label="Sửa công thức" size={34} onClick={() => setEditing(x)}>
                    <ClipboardList size={15} />
                  </IconButton>
                ) : null
              }
            />
          )}
        </Card>
      )}
      {creating && semis.data && (
        <ProductionDialog semis={semis.data} admin={admin} onClose={() => setCreating(false)} />
      )}
      {viewing && <ProductionView p={viewing} admin={admin} onClose={() => setViewing(null)} />}
      {editing && <RecipeDialog semi={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function LinesEditor({ lines, setLines }: { lines: Line[]; setLines: (l: Line[]) => void }) {
  const ings = useIngredients().data;
  const set = (key: number, patch: Partial<Line>) =>
    setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  return (
    <div className="flex flex-col gap-2">
      {lines.map((l) => {
        const ing = ings?.find((i) => i.id === l.ingredientId);
        return (
          <div key={l.key} className="grid grid-cols-[minmax(0,1fr)_110px_40px] items-end gap-2">
            <Field label="Nguyên liệu">
              {() => (
                <IngredientPicker
                  value={l.ingredientId}
                  onChange={(i) => set(l.key, { ingredientId: i.id })}
                />
              )}
            </Field>
            <Field label={`Số lượng${ing ? ` (${ing.unit})` : ''}`}>
              {(id) => (
                <Input
                  id={id}
                  inputMode="decimal"
                  className="num text-right"
                  value={l.qty}
                  onChange={(e) => set(l.key, { qty: e.target.value })}
                />
              )}
            </Field>
            <IconButton
              label="Bỏ dòng"
              type="button"
              onClick={() => setLines(lines.filter((x) => x.key !== l.key))}
            >
              <Trash2 size={16} />
            </IconButton>
          </div>
        );
      })}
      <div>
        <Button size="sm" icon={<Plus size={14} />} onClick={() => setLines([...lines, newLine()])}>
          Thêm nguyên liệu
        </Button>
      </div>
    </div>
  );
}

const validLines = (lines: Line[]) =>
  lines.length > 0 && lines.every((l) => l.ingredientId !== null && parseQty(l.qty) > 0);

function ProductionDialog({
  semis,
  admin,
  onClose,
}: {
  semis: SemiDto[];
  admin: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const today = useBusinessToday();
  const [date, setDate] = useBusinessDateState();
  const [semiId, setSemiId] = useState(semis[0]!.ingredientId);
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [estimate, setEstimate] = useState<string | null | undefined>(undefined);
  const semi = semis.find((x) => x.ingredientId === semiId)!;

  const plan = useMutation({
    mutationFn: async () =>
      ok(await client.production.plan({ body: { ingredientId: semiId, qty: num(qty), date } })),
    onSuccess: (r) => {
      if (!r.inputs.length)
        return toast('Bán thành phẩm này chưa có công thức — nhập nguyên liệu tay', 'bad');
      setLines(r.inputs.map((i) => newLine(i.ingredientId, i.qty)));
      setEstimate(r.estimatedCost);
    },
    onError: (e) => toast(errorMessage(e), 'bad'),
  });
  const save = useMutation({
    mutationFn: async () =>
      ok(
        await client.production.create({
          body: {
            date,
            ingredientId: semiId,
            qty: num(qty),
            note: note.trim() || null,
            inputs: lines.map((l) => ({ ingredientId: l.ingredientId!, qty: num(l.qty) })),
          },
        }),
      ),
    onSuccess: (p) => {
      toast(`Đã ghi ${qtyUnit(p.qty, p.unit)} ${p.name}`);
      qc.invalidateQueries({ queryKey: ['productions'] });
      qc.invalidateQueries({ queryKey: ['semis'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
      onClose();
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title="Ghi phiếu chế biến"
      width={640}
      footer={
        <>
          <Button onClick={onClose}>Huỷ bỏ</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!(parseQty(qty) > 0) || !validLines(lines)}
            onClick={() => save.mutate()}
          >
            Lưu
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_150px_150px]">
          <Field label="Bán thành phẩm">
            {(id) => (
              <Select id={id} value={semiId} onChange={(e) => setSemiId(Number(e.target.value))}>
                {semis.map((x) => (
                  <option key={x.ingredientId} value={x.ingredientId}>
                    {x.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={`Thu được (${semi.unit})`}>
            {(id) => (
              <Input
                id={id}
                inputMode="decimal"
                className="num text-right"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            )}
          </Field>
          <Field label="Ngày nấu">
            {() => <DateInput aria-label="Ngày nấu" value={date} max={today} onChange={setDate} />}
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            icon={<Wand2 size={16} />}
            loading={plan.isPending}
            disabled={!(parseQty(qty) > 0) || !semi.recipe}
            onClick={() => plan.mutate()}
          >
            Điền nguyên liệu theo công thức
          </Button>
          {admin && estimate !== undefined && (
            <span className="text-[13px] text-muted">
              Ước tính {estimate ? `${money(estimate)} ₫` : '— (có nguyên liệu chưa có giá)'}; giá vốn thật
              tính FIFO khi lưu
            </span>
          )}
          {!semi.recipe && (
            <span className="text-[13px] text-warn">Chưa có công thức — nhập nguyên liệu tay</span>
          )}
        </div>
        <LinesEditor lines={lines} setLines={setLines} />
        <Field label="Ghi chú">
          {(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        <p className="text-xs text-muted">
          Nguyên liệu phải có trong kho vào ngày nấu (nhập phiếu nhập trước). Món bán trước khi ghi phiếu này
          được tính lại giá vốn theo mẻ này.
        </p>
        <FormError message={save.error ? errorMessage(save.error) : null} />
      </div>
    </Dialog>
  );
}

function ProductionView({ p, admin, onClose }: { p: ProductionDto; admin: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [deleting, setDeleting] = useState(false);
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Chế biến ${p.name} · ${dateVi(p.date)}`}
      width={560}
      footer={
        <>
          {!p.used && !p.locked && (
            <Button
              variant="danger"
              className="mr-auto"
              icon={<Trash2 size={16} />}
              onClick={() => setDeleting(true)}
            >
              Xoá phiếu
            </Button>
          )}
          <Button onClick={onClose}>Đóng</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <p className="flex items-center gap-2 text-[13px] text-muted">
          <ChefHat size={16} /> Thu được <b className="text-ink">{qtyUnit(p.qty, p.unit)}</b>
          {admin && (
            <>
              · giá vốn <b className="num text-ink">{money(p.unitCost)}</b> / {p.unit}
            </>
          )}
          · {p.createdBy}
        </p>
        <div className="divide-y divide-line-soft rounded-ctl border border-line-soft">
          {p.inputs.map((i) => (
            <div key={i.ingredientId} className="flex justify-between gap-3 px-3 py-2">
              <span>{i.name}</span>
              <span className="num">
                {qtyUnit(i.qty, i.unit)}
                {admin && i.cost !== undefined && <span className="ml-2 text-muted">{money(i.cost)}</span>}
              </span>
            </div>
          ))}
        </div>
        {p.note && <p className="text-[13px] text-muted">Ghi chú: {p.note}</p>}
        {p.used && (
          <p className="text-xs text-faint">Mẻ này đã được dùng (bán / kiểm kê) nên không xoá được.</p>
        )}
      </div>
      <ReasonDialog
        open={deleting}
        danger
        title="Xoá phiếu chế biến"
        description="Nguyên liệu được hoàn lại kho, lô thành phẩm bị xoá."
        confirmLabel="Xoá"
        onClose={() => setDeleting(false)}
        onConfirm={async (reason) => {
          ok(await client.production.remove({ params: { id: p.id }, body: { reason } }));
          toast('Đã xoá phiếu chế biến');
          qc.invalidateQueries({ queryKey: ['productions'] });
          qc.invalidateQueries({ queryKey: ['semis'] });
          onClose();
        }}
      />
    </Dialog>
  );
}

function RecipeDialog({ semi, onClose }: { semi: SemiDto; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const today = useBusinessToday();
  const r = semi.recipe;
  const [from, setFrom] = useState(today);
  const [yieldQty, setYieldQty] = useState(r?.yieldQty ?? '');
  const [note, setNote] = useState(r?.note ?? '');
  const [lines, setLines] = useState<Line[]>(
    r ? r.items.map((i) => newLine(i.ingredientId, i.qty)) : [newLine()],
  );
  const save = useMutation({
    mutationFn: async () =>
      ok(
        await client.production.saveRecipe({
          params: { id: semi.ingredientId },
          body: {
            effectiveFrom: from,
            yieldQty: num(yieldQty),
            note: note.trim() || null,
            items: lines.map((l) => ({ ingredientId: l.ingredientId!, qty: num(l.qty) })),
          },
        }),
      ),
    onSuccess: () => {
      toast('Đã lưu công thức');
      qc.invalidateQueries({ queryKey: ['semis'] });
      qc.invalidateQueries({ queryKey: ['pricing'] });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Công thức nấu: ${semi.name}`}
      width={620}
      footer={
        <>
          <Button onClick={onClose}>Huỷ bỏ</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!(parseQty(yieldQty) > 0) || !validLines(lines)}
            onClick={() => save.mutate()}
          >
            Lưu
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={`Một mẻ thu được (${semi.unit})`}>
            {(id) => (
              <Input
                id={id}
                inputMode="decimal"
                className="num text-right"
                value={yieldQty}
                onChange={(e) => setYieldQty(e.target.value)}
              />
            )}
          </Field>
          <Field label="Áp dụng từ ngày" hint="Mẻ nấu từ ngày này dùng công thức mới">
            {() => <DateInput aria-label="Áp dụng từ ngày" value={from} onChange={setFrom} />}
          </Field>
        </div>
        <LinesEditor lines={lines} setLines={setLines} />
        <Field label="Ghi chú">
          {(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        <p className="text-xs text-muted">
          Số lượng theo đơn vị kho của từng nguyên liệu (kg, lít…). Giá vốn bán thành phẩm trong Bảng tính giá
          = công thức × giá nhập mới nhất ÷ sản lượng một mẻ.
        </p>
        <FormError message={save.error ? errorMessage(save.error) : null} />
      </div>
    </Dialog>
  );
}
