// A month's / year's documents as one .zip: a folder per document with its files + an Excel list.
import { existsSync } from 'node:fs';
import type { Writable } from 'node:stream';
import archiver from 'archiver';
import ExcelJS from 'exceljs';
import { prisma } from '../../core/db';
import { defaultBranchId } from '../../core/branch';
import { storedPath } from '../../core/storage';
import { fromDbDate } from '../../domain/business-date';
import {
  archiveBaseName,
  documentFolderName,
  uniqueNames,
  windowsSafe,
} from '../../domain/documents/archive-names';
import { DOCUMENT_KIND_LABELS } from '../../contracts/documents.contract';
import { periodRange } from './documents.service';

async function load(period: string) {
  const rows = await prisma.document.findMany({
    where: { branchId: await defaultBranchId(), deletedAt: null, date: periodRange(period) },
    include: { files: { where: { deletedAt: null }, orderBy: { id: 'asc' } } },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
  });
  const folders = uniqueNames(
    rows.map((d) =>
      documentFolderName({
        date: fromDbDate(d.date),
        kindLabel: DOCUMENT_KIND_LABELS[d.kind],
        partner: d.partner,
        number: d.number,
      }),
    ),
  );
  return rows.map((d, i) => {
    const names = uniqueNames(d.files.map((f) => windowsSafe(f.name, 120)));
    return {
      doc: d,
      folder: folders[i]!,
      files: d.files.map((f, j) => ({
        abs: storedPath(f.path),
        name: names[j]!,
        missing: !existsSync(storedPath(f.path)),
      })),
    };
  });
}

async function listWorkbook(period: string, items: Awaited<ReturnType<typeof load>>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Chứng từ');
  ws.addRow([`Danh sách chứng từ ${period.length === 4 ? 'năm' : 'tháng'} ${period}`]).font = {
    bold: true,
    size: 14,
  };
  ws.addRow([]);
  const header = ws.addRow([
    'Ngày',
    'Loại',
    'Đối tác',
    'Số hoá đơn',
    'Số tiền',
    'Ghi chú',
    'Phiếu nhập',
    'Số file',
    'Thư mục trong file nén',
  ]);
  header.font = { bold: true };
  for (const { doc, folder, files } of items) {
    const missing = files.filter((f) => f.missing).length;
    ws.addRow([
      fromDbDate(doc.date).split('-').reverse().join('/'),
      DOCUMENT_KIND_LABELS[doc.kind],
      doc.partner ?? '',
      doc.number ?? '',
      doc.amount === null ? null : Number(doc.amount),
      doc.note ?? '',
      doc.receiptId ? `PN${String(doc.receiptId).padStart(6, '0')}` : '',
      missing ? `${files.length} (thiếu ${missing} file trên máy chủ)` : files.length,
      folder,
    ]);
  }
  [12, 10, 30, 14, 14, 30, 12, 10, 60].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.getColumn(5).numFmt = '#,##0';
  ws.views = [{ state: 'frozen', ySplit: 3 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Stream the .zip for `period` ("YYYY-MM" or "YYYY") into `out`; resolves once everything is written. */
export async function writeDocumentsZip(period: string, out: Writable) {
  const items = await load(period);
  const root = archiveBaseName(period);
  const zip = archiver('zip', { zlib: { level: 1 } }); // photos / PDFs are already compressed
  const done = new Promise<void>((resolve, reject) => {
    out.on('close', resolve);
    out.on('finish', resolve);
    out.on('error', reject);
    zip.on('error', reject);
  });
  zip.pipe(out);
  zip.append(await listWorkbook(period, items), { name: `${root}/Danh sach chung tu.xlsx` });
  let fileCount = 0;
  for (const { folder, files } of items) {
    for (const f of files) {
      if (f.missing) continue;
      zip.file(f.abs, { name: `${root}/${folder}/${f.name}` });
      fileCount++;
    }
  }
  await zip.finalize();
  await done;
  return { documents: items.length, files: fileCount, bytes: zip.pointer() };
}

export const zipFileName = (period: string) => `${archiveBaseName(period)}.zip`;
