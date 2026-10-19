import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, CloudUpload, DatabaseBackup } from 'lucide-react';
import type { BackupRun, Settings } from '@ketoan/api/contracts';
import { Button } from '@/components/ui/Button';
import { Card, Select, Switch } from '@/components/ui/controls';
import { Field } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { client, errorMessage, ok } from '@/lib/api-client';
import { cn } from '@/lib/cn';

const when = (iso: string) =>
  new Date(iso).toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
const size = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
    : `${Math.round(bytes / 1024)} KB`;

function RunLine({ run }: { run: BackupRun }) {
  return (
    <span>
      {when(run.at)} · {run.trigger === 'AUTO' ? 'tự động' : 'bấm tay'}
      {run.ok && run.bytes !== null && ` · ${size(run.bytes)}`}
    </span>
  );
}

/** "Sao lưu dữ liệu" card of the settings page: status, schedule, Drive copy, run now. */
export function BackupSection({ s, setS }: { s: Settings; setS: (s: Settings) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const status = useQuery({
    queryKey: ['backups'],
    queryFn: async () => ok(await client.backups.status()),
  });
  const run = useMutation({
    mutationFn: async () => ok(await client.backups.run({ body: {} })),
    onSuccess: (data) => {
      qc.setQueryData(['backups'], data);
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      if (data.last?.ok)
        toast(
          data.last.drive?.ok === false
            ? 'Đã sao lưu trên máy, chưa gửi được lên Drive'
            : 'Đã sao lưu dữ liệu',
        );
      else toast(data.last?.error ?? 'Sao lưu thất bại', 'bad');
    },
    onError: (e) => toast(errorMessage(e), 'bad'),
  });
  const b = status.data;
  const last = b?.last;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-ink-strong">Sao lưu dữ liệu</h2>
          <p className="mt-0.5 text-[13px] text-muted">
            Toàn bộ dữ liệu được sao lưu mỗi ngày trên máy chủ (giữ {b?.keep ?? 30} bản mới nhất)
            {b?.drive.connected && s.backup_drive ? ' và gửi một bản lên Google Drive' : ''}.
          </p>
        </div>
        <Button
          icon={<DatabaseBackup size={16} />}
          loading={run.isPending || b?.running}
          onClick={() => run.mutate()}
        >
          Sao lưu ngay
        </Button>
      </div>

      {b && (
        <div
          className={cn(
            'mt-4 flex items-start gap-2 rounded-ctl px-3 py-2.5 text-[13px]',
            b.issue && b.issue !== 'DRIVE_FAILED' ? 'bg-warn-soft text-warn' : 'bg-good-soft text-good',
          )}
        >
          {b.issue && b.issue !== 'DRIVE_FAILED' ? (
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          ) : (
            <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          )}
          <div className="flex flex-col gap-0.5">
            {b.lastOk ? (
              <span>
                Bản gần nhất: <RunLine run={b.lastOk} />
              </span>
            ) : (
              <span>Chưa có bản sao lưu nào.</span>
            )}
            {last && !last.ok && (
              <span>
                Lần chạy {when(last.at)} bị lỗi: {last.error}
              </span>
            )}
            <span className="opacity-80">Lần tự động tiếp theo: {when(b.nextAt)}</span>
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Giờ sao lưu tự động">
          {(id) => (
            <Select
              id={id}
              value={String(s.backup_hour)}
              onChange={(e) => setS({ ...s, backup_hour: Number(e.target.value) })}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, '0')}:00
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="flex flex-col gap-1.5 sm:col-span-1 lg:col-span-2">
          {b?.drive.connected ? (
            <>
              <Switch
                checked={s.backup_drive}
                onChange={(v) => setS({ ...s, backup_drive: v })}
                label={`Gửi lên Google Drive (${b.drive.email ?? 'đã kết nối'})`}
                description={`Thư mục "Kế toán quán - Sao lưu dữ liệu", giữ ${b.keep} bản mới nhất`}
              />
              {last?.drive && (
                <p className={cn('text-xs', last.drive.ok ? 'text-faint' : 'text-warn')}>
                  <CloudUpload size={12} className="mr-1 inline" />
                  {last.drive.ok ? (
                    <>
                      Đã gửi bản {when(last.at)}
                      {last.drive.link && (
                        <>
                          {' '}
                          ·{' '}
                          <a className="underline" href={last.drive.link} target="_blank" rel="noreferrer">
                            mở trên Drive
                          </a>
                        </>
                      )}
                    </>
                  ) : (
                    `Chưa gửi được lên Drive: ${last.drive.error}`
                  )}
                </p>
              )}
            </>
          ) : (
            <p className="text-[13px] text-muted">
              Chưa kết nối Google Drive nên bản sao lưu chỉ nằm trên máy chủ. Kết nối ở mục{' '}
              <a className="text-primary-ink underline" href="#google-drive">
                Google Drive
              </a>{' '}
              phía trên, sau đó mỗi bản sao lưu sẽ tự gửi lên Drive.
            </p>
          )}
        </div>
      </div>

      {!!b?.files.length && (
        <details className="mt-4 text-[13px]">
          <summary className="cursor-pointer text-muted">
            Các bản trên máy chủ ({b.files.length} mới nhất)
          </summary>
          <ul className="mt-2 grid gap-1">
            {b.files.map((f) => (
              <li key={f.name} className="flex justify-between gap-3">
                <span className="num truncate">{f.name}</span>
                <span className="num shrink-0 text-muted">
                  {when(f.at)} · {size(f.bytes)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
