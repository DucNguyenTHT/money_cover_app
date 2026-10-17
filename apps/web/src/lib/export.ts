import { tokenStore } from './api-client';

export type ExportKind = 'text' | 'money' | 'qty' | 'pct' | 'int';
export interface ExportSheet {
  name: string;
  columns: { header: string; kind: ExportKind }[];
  rows: (string | number | null)[][];
  /** Row indexes to make bold (total rows). */
  bold?: number[];
}

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Server renders a real .xlsx (number formats, frozen header). */
export async function exportXlsx(filename: string, title: string, sheets: ExportSheet[]) {
  const res = await fetch('/api/reports/export.xlsx', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenStore.get()}` },
    body: JSON.stringify({ filename, title, sheets }),
  });
  if (!res.ok) throw new Error('Không xuất được file Excel');
  save(await res.blob(), `${filename}.xlsx`);
}

/** CSV of the first sheet, UTF-8 with BOM so Excel shows Vietnamese correctly. */
export function exportCsv(filename: string, sheet: ExportSheet) {
  const cell = (v: string | number | null) => {
    const s = v === null ? '' : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    sheet.columns.map((c) => cell(c.header)).join(','),
    ...sheet.rows.map((r) => r.map(cell).join(',')),
  ];
  save(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `${filename}.csv`);
}
