import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Spinner } from './Button';
import { EmptyState } from './controls';

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  /** Hidden on tablets; still shown in the phone card view. */
  secondary?: boolean;
  className?: string;
}

/**
 * Dense table on tablet/desktop; on phones each row becomes a compact card
 * (first column as the title, the rest as label: value lines).
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  loading,
  empty,
  onRowClick,
  actions,
}: {
  rows: T[] | undefined;
  columns: Column<T>[];
  rowKey: (row: T) => string | number;
  loading?: boolean;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  actions?: (row: T) => ReactNode;
}) {
  if (loading && !rows) {
    return (
      <div className="flex justify-center py-12 text-primary-ink">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (!rows || rows.length === 0) return <>{empty ?? <EmptyState title="Chưa có dữ liệu" />}</>;

  const align = (a?: Column<T>['align']) =>
    a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left';
  const [first, ...rest] = columns;

  return (
    <>
      <div
        tabIndex={0}
        role="region"
        aria-label="Bảng, cuộn ngang để xem thêm cột"
        className="hidden overflow-x-auto sm:block"
      >
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-primary-soft text-[13px] text-ink-strong">
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    'px-4 py-2.5 font-semibold',
                    align(c.align),
                    c.secondary && 'hidden lg:table-cell',
                  )}
                >
                  {c.header}
                </th>
              ))}
              {actions && <th className="w-px px-4 py-2.5" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={rowKey(r)}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={cn('border-b border-[#f2f4f7]', onRowClick && 'cursor-pointer hover:bg-[#f8fafd]')}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      'px-4 py-2.5',
                      align(c.align),
                      c.secondary && 'hidden lg:table-cell',
                      c.className,
                    )}
                  >
                    {c.cell(r)}
                  </td>
                ))}
                {actions && (
                  <td className="px-4 py-1.5" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1.5">{actions(r)}</div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-[#f2f4f7] sm:hidden">
        {rows.map((r) => (
          <li
            key={rowKey(r)}
            onClick={onRowClick ? () => onRowClick(r) : undefined}
            className={cn(
              'flex flex-col gap-1 px-4 py-3',
              onRowClick && 'cursor-pointer active:bg-[#f8fafd]',
            )}
          >
            {first && <div className="font-semibold text-ink-strong">{first.cell(r)}</div>}
            {rest.map((c) => (
              <div key={c.key} className="flex justify-between gap-3 text-[13px]">
                <span className="text-faint">{c.header}</span>
                <span className="text-right">{c.cell(r)}</span>
              </div>
            ))}
            {actions && (
              <div className="mt-1 flex gap-2" onClick={(e) => e.stopPropagation()}>
                {actions(r)}
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
