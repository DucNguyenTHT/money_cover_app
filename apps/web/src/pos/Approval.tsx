import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Delete, ShieldCheck } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { HttpError, errorMessage } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { useApprovers } from './data';

export interface Approval {
  approverId: number;
  pin: string;
}

type Ask = (reason: string) => Promise<Approval | null>;
const Ctx = createContext<Ask>(async () => null);

/**
 * Hộp thoại "ADMIN duyệt": the admin picks their name and types the PIN on a number pad.
 * `askApproval(message)` resolves with the approval, or null when cancelled.
 */
export function ApprovalProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const [approverId, setApproverId] = useState<number | null>(null);
  const [pin, setPin] = useState('');
  const resolver = useRef<((a: Approval | null) => void) | null>(null);
  const approvers = useApprovers();

  const ask = useCallback<Ask>((reason) => {
    setMessage(reason);
    setPin('');
    return new Promise((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const finish = (a: Approval | null) => {
    resolver.current?.(a);
    resolver.current = null;
    setMessage(null);
    setPin('');
  };

  const list = approvers.data ?? [];
  const chosen = approverId ?? list[0]?.id ?? null;
  const press = (d: string) => setPin((p) => (p.length < 6 ? p + d : p));

  return (
    <Ctx.Provider value={ask}>
      {children}
      <Dialog
        open={message !== null}
        onClose={() => finish(null)}
        title="ADMIN duyệt"
        width={380}
        footer={
          <>
            <Button onClick={() => finish(null)}>Huỷ bỏ</Button>
            <Button
              variant="primary"
              disabled={!chosen || pin.length < 4}
              onClick={() => chosen && finish({ approverId: chosen, pin })}
              icon={<ShieldCheck size={18} />}
            >
              Duyệt
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="rounded-ctl bg-warn-soft px-3 py-2 text-[13px] text-warn">{message}</p>
          {list.length === 0 ? (
            <p className="text-[13px] text-muted">
              Chưa có ADMIN nào đặt mã PIN duyệt (Tài khoản của tôi → Mã PIN duyệt).
            </p>
          ) : (
            <label className="flex flex-col gap-1.5 text-[13px] font-medium">
              Người duyệt
              <select
                value={chosen ?? ''}
                onChange={(e) => setApproverId(Number(e.target.value))}
                className="h-10 rounded-ctl border border-field bg-white px-3 text-sm font-normal"
              >
                {list.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.fullName}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div
            aria-label="Mã PIN"
            className="flex h-12 items-center justify-center gap-3 rounded-ctl border border-field bg-page"
          >
            {Array.from({ length: 6 }, (_, i) => (
              <span
                key={i}
                className={cn('size-3 rounded-full', i < pin.length ? 'bg-ink-strong' : 'bg-field')}
              />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <PadKey key={d} onClick={() => press(d)}>
                {d}
              </PadKey>
            ))}
            <PadKey onClick={() => setPin('')}>Xoá</PadKey>
            <PadKey onClick={() => press('0')}>0</PadKey>
            <PadKey onClick={() => setPin((p) => p.slice(0, -1))} label="Xoá 1 số">
              <Delete size={18} />
            </PadKey>
          </div>
        </div>
      </Dialog>
    </Ctx.Provider>
  );
}

export function PadKey({
  children,
  onClick,
  label,
}: {
  children: ReactNode;
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-12 items-center justify-center rounded-ctl border border-field bg-white text-lg font-semibold text-ink-strong shadow-[var(--shadow-btn)] active:bg-track"
    >
      {children}
    </button>
  );
}

export const useAskApproval = () => useContext(Ctx);

/**
 * Run `action`; if the server answers 403 NEEDS_APPROVAL, ask an ADMIN for their PIN and retry with it.
 * A wrong PIN asks again (the server locks the PIN after 5 failures).
 */
export function useWithApproval() {
  const ask = useAskApproval();
  return async function withApproval<T>(action: (approval?: Approval) => Promise<T>): Promise<T | null> {
    try {
      return await action();
    } catch (e) {
      if (!(e instanceof HttpError && e.code === 'NEEDS_APPROVAL')) throw e;
      let message = e.message;
      for (;;) {
        const approval = await ask(message);
        if (!approval) return null;
        try {
          return await action(approval);
        } catch (err) {
          if (err instanceof HttpError && err.status === 403) {
            message = errorMessage(err);
            continue;
          }
          throw err;
        }
      }
    }
  };
}
