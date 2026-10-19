import { useState } from 'react';
import { Check } from 'lucide-react';
import type { DishDto } from '@ketoan/api/contracts';
import { defaultOptionIds, resolveOptions, type OptionGroupDef } from '@ketoan/api/domain';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { FormError } from '@/auth/AuthCard';
import { money } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Stepper } from './OrderDialogs';

/** Toggle one option inside its group: "pick one" groups swap, "pick several" groups add / remove. */
function toggle(groups: readonly OptionGroupDef[], ids: number[], optionId: number): number[] {
  const g = groups.find((x) => x.options.some((o) => o.id === optionId))!;
  if (ids.includes(optionId)) return g.required && !g.multi ? ids : ids.filter((id) => id !== optionId);
  if (g.multi) return [...ids, optionId];
  const others = new Set(g.options.map((o) => o.id));
  return [...ids.filter((id) => !others.has(id)), optionId];
}

/** Big touch chips per group (radio-like for size, checkbox-like for toppings). */
export function OptionChooser({
  groups,
  value,
  onChange,
}: {
  groups: readonly OptionGroupDef[];
  value: number[];
  onChange: (ids: number[]) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {groups
        .filter((g) => g.active)
        .map((g) => (
          <fieldset key={g.id} className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-[13px] font-semibold text-ink-strong">
              {g.name}{' '}
              <span className="font-normal text-faint">
                {g.multi
                  ? g.maxSelect
                    ? `· chọn tối đa ${g.maxSelect}`
                    : '· chọn nhiều'
                  : g.required
                    ? '· chọn 1'
                    : '· chọn 1 (không bắt buộc)'}
              </span>
            </legend>
            <div className="flex flex-wrap gap-2">
              {g.options
                .filter((o) => o.active || value.includes(o.id))
                .map((o) => {
                  const on = value.includes(o.id);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      role={g.multi ? 'checkbox' : 'radio'}
                      aria-checked={on}
                      onClick={() => onChange(toggle(groups, value, o.id))}
                      className={cn(
                        'flex min-h-11 items-center gap-1.5 rounded-ctl border px-3.5 text-sm',
                        on
                          ? 'border-primary bg-primary-soft font-semibold text-primary-ink'
                          : 'border-field bg-white text-ink',
                      )}
                    >
                      {on && <Check size={15} />}
                      {o.name}
                      {Number(o.price) > 0 && <span className="num text-xs">+{money(Number(o.price))}</span>}
                    </button>
                  );
                })}
            </div>
          </fieldset>
        ))}
    </div>
  );
}

/** Choose the options (and how many) before adding a dish to the order. */
export function OptionPickerDialog({
  dish,
  price,
  groups,
  onAdd,
  onClose,
}: {
  dish: DishDto;
  /** Dish price on this channel (before options). */
  price: string;
  groups: readonly OptionGroupDef[];
  onAdd: (optionIds: number[], qty: number) => void;
  onClose: () => void;
}) {
  const [ids, setIds] = useState(() => defaultOptionIds(groups));
  const [qty, setQty] = useState(1);
  const [tried, setTried] = useState(false);
  const r = resolveOptions(groups, ids);
  const unit = Number(price) + ('error' in r ? 0 : r.price.toNumber());

  return (
    <Dialog
      open
      onClose={onClose}
      title={dish.name}
      width={520}
      footer={
        <>
          <Stepper label="Số lượng" value={qty} min={1} max={99} onChange={setQty} />
          <span className="flex-1" />
          <Button onClick={onClose}>Đóng</Button>
          <Button
            variant="primary"
            onClick={() => {
              setTried(true);
              if (!('error' in r)) onAdd(ids, qty);
            }}
          >
            Thêm · {money(unit * qty)}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <OptionChooser groups={groups} value={ids} onChange={setIds} />
        {tried && 'error' in r && <FormError message={r.error} />}
      </div>
    </Dialog>
  );
}
