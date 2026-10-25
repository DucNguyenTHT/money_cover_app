import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Search, UserPlus, UserRound, X } from 'lucide-react';
import type { CustomerDto, OrderDto } from '@ketoan/api/contracts';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { FormError } from '@/auth/AuthCard';
import { client, errorMessage, ok } from '@/lib/api-client';
import { money } from '@/lib/format';

/** Pick (or add) the regular customer of an order: search by phone or name. */
export function CustomerDialog({
  order,
  open,
  onClose,
  onDone,
}: {
  order: OrderDto;
  open: boolean;
  onClose: () => void;
  onDone: (o: OrderDto) => void;
}) {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [adding, setAdding] = useState(false);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');

  useEffect(() => {
    if (!open) return;
    setQ('');
    setTerm('');
    setAdding(false);
  }, [open]);
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const found = useQuery({
    queryKey: ['customers', 'search', term],
    queryFn: async () => ok(await client.customers.list({ query: { q: term, limit: 20 } })),
    enabled: open && term.length >= 2,
  });
  const choose = useMutation({
    mutationFn: async (customerId: number | null) =>
      ok(
        await client.orders.update({
          params: { id: order.id },
          body: { version: order.version, customerId },
        }),
      ),
    onSuccess: onDone,
  });
  const create = useMutation({
    mutationFn: async () => ok(await client.customers.create({ body: { phone, name } })),
    onSuccess: (c) => choose.mutate(c.id),
  });

  const pick = (c: CustomerDto) => choose.mutate(c.id);
  const error = choose.error ?? create.error;

  return (
    <Dialog open={open} onClose={onClose} title="Khách quen của đơn" width={480}>
      <div className="flex flex-col gap-3">
        {order.customer && (
          <div className="flex items-center justify-between gap-2 rounded-ctl bg-primary-soft px-3 py-2 text-[13px]">
            <span className="flex items-center gap-2">
              <UserRound size={16} className="text-primary-ink" />
              <b>{order.customer.name}</b> · {order.customer.phone} · {money(order.customer.points)} điểm
            </span>
            <Button
              size="sm"
              variant="ghost"
              icon={<X size={14} />}
              loading={choose.isPending}
              onClick={() => choose.mutate(null)}
            >
              Bỏ
            </Button>
          </div>
        )}
        {!adding ? (
          <>
            <label className="relative">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
              />
              <Input
                autoFocus
                inputMode="search"
                placeholder="Số điện thoại hoặc tên"
                className="pl-9"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
            <ul className="flex max-h-72 flex-col divide-y divide-line-soft overflow-y-auto rounded-ctl border border-line-soft">
              {(found.data ?? []).map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => pick(c)}
                    disabled={choose.isPending}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-page"
                  >
                    <span>
                      <b className="text-ink-strong">{c.name}</b>
                      <span className="block text-xs text-muted">
                        {c.phone} · {c.visits} lần ghé
                      </span>
                    </span>
                    <span className="num text-[13px] font-semibold text-primary-ink">
                      {money(c.points)} điểm
                    </span>
                  </button>
                </li>
              ))}
              {term.length >= 2 && found.data?.length === 0 && (
                <li className="px-3 py-3 text-[13px] text-muted">Không thấy khách “{term}”.</li>
              )}
            </ul>
            <div>
              <Button
                icon={<UserPlus size={16} />}
                onClick={() => {
                  setAdding(true);
                  setPhone(/\d/.test(q) ? q.trim() : '');
                  setName(/\d/.test(q) ? '' : q.trim());
                }}
              >
                Thêm khách mới
              </Button>
            </div>
          </>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (phone.trim() && name.trim()) create.mutate();
            }}
          >
            <label className="flex flex-col gap-1 text-[13px] font-medium">
              Số điện thoại
              <Input
                autoFocus
                inputMode="tel"
                className="num"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-medium">
              Tên khách
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <div className="flex gap-2">
              <Button
                type="submit"
                variant="primary"
                loading={create.isPending || choose.isPending}
                disabled={!phone.trim() || !name.trim()}
              >
                Lưu & chọn
              </Button>
              <Button type="button" onClick={() => setAdding(false)}>
                Quay lại
              </Button>
            </div>
          </form>
        )}
        <FormError message={error ? errorMessage(error) : null} />
      </div>
    </Dialog>
  );
}
