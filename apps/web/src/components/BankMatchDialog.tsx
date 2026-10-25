import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { BankTxnDto } from '@ketoan/api/contracts';
import { FormError } from '@/auth/AuthCard';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input } from '@/components/ui/Input';
import { client, errorMessage, ok } from '@/lib/api-client';
import { money } from '@/lib/format';

/** '24/10 01:53' in shop time. */
const time = (iso: string) => {
  const d = new Date(Date.parse(iso) + 7 * 3600_000).toISOString();
  return `${d.slice(8, 10)}/${d.slice(5, 7)} ${d.slice(11, 16)}`;
};

/** Tie a received transfer to an order by its code (used at day closing and on the bank page). */
export function BankMatchDialog({
  txn,
  onClose,
  onDone,
}: {
  txn: BankTxnDto;
  onClose: () => void;
  onDone: (t: BankTxnDto) => void;
}) {
  const [code, setCode] = useState('');
  const save = useMutation({
    mutationFn: async () =>
      ok(await client.bank.match({ params: { id: txn.id }, body: { orderCode: code.trim() } })),
    onSuccess: onDone,
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Gán tiền về cho đơn"
      width={460}
      footer={
        <>
          <Button onClick={onClose}>Huỷ bỏ</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={code.trim().length < 3}
            onClick={() => save.mutate()}
          >
            Gán
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim().length >= 3) save.mutate();
        }}
      >
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-ctl bg-page p-3 text-[13px]">
          <dt className="text-muted">Số tiền</dt>
          <dd className="num font-semibold">{money(txn.amount)} ₫</dd>
          <dt className="text-muted">Lúc</dt>
          <dd>{time(txn.transactedAt)}</dd>
          <dt className="text-muted">Nội dung</dt>
          <dd className="break-words">{txn.description || '—'}</dd>
        </dl>
        <Field label="Mã đơn" hint="Dạng 261023-015 — xem ở Danh sách đơn hoặc trên bill">
          {(id, d) => (
            <Input
              id={id}
              aria-describedby={d}
              autoFocus
              className="num"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          )}
        </Field>
        <FormError message={save.error ? errorMessage(save.error) : null} />
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
