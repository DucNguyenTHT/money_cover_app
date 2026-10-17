// Scanned invoices / e-invoice files, filed by date. Archive only: nothing here touches stock or P&L.
import { createHash, randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma, inTx, type Db } from '../../core/db';
import type { AuthUser } from '../../core/auth';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors';
import { writeAudit } from '../../core/audit';
import { assertPeriodOpen } from '../../core/period-lock';
import { defaultBranchId } from '../../core/branch';
import { discardFile, storeFile } from '../../core/storage';
import { fromDbDate, toDbDate } from '../../domain/business-date';
import { sum } from '../../domain/money';
import {
  MAX_FILE_BYTES,
  MAX_FILES_PER_DOCUMENT,
  MAX_THUMB_BYTES,
  detectFileType,
  safeFileName,
} from '../../domain/documents/file-type';
import { DOCUMENT_KINDS, type DocumentKind } from '../../domain/enums';
import { changeRight } from '../../domain/documents/permissions';
import type {
  DocumentDetail,
  DocumentFileDto,
  DocumentInput,
  DocumentList,
  FileUpload,
} from '../../contracts/documents.contract';

const liveFiles = { where: { deletedAt: null }, orderBy: { id: 'asc' } } as const;
type DocRow = Prisma.DocumentGetPayload<{ include: { files: typeof liveFiles } }>;
type FileRow = DocRow['files'][number];

async function userNames(db: Db, ids: number[]) {
  const users = await db.user.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, fullName: true },
  });
  return new Map(users.map((u) => [u.id, u.fullName]));
}

async function lockedMonths(db: Db, branchId: number) {
  const locks = await db.periodLock.findMany({ where: { branchId } });
  return new Set(locks.map((l) => `${l.year}-${String(l.month).padStart(2, '0')}`));
}

/** "2026-10" → that month; "2026" → the whole year. */
export function periodRange(period: string) {
  const [y, m] = period.split('-').map(Number) as [number, number | undefined];
  if (m === undefined) return { gte: toDbDate(`${y}-01-01`), lt: toDbDate(`${y + 1}-01-01`) };
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return { gte: toDbDate(`${period}-01`), lt: toDbDate(`${next}-01`) };
}

const fileView = (f: FileRow, names: Map<number, string>): DocumentFileDto => ({
  id: f.id,
  name: f.name,
  mime: f.mime,
  size: f.size,
  hasThumb: !!f.thumbPath,
  createdAt: f.createdAt.toISOString(),
  createdBy: names.get(f.createdById) ?? '',
  createdById: f.createdById,
});

function docView(d: DocRow, names: Map<number, string>, locked: Set<string>): DocumentDetail {
  const date = fromDbDate(d.date);
  const files = d.files.map((f) => fileView(f, names));
  return {
    id: d.id,
    kind: d.kind,
    date,
    number: d.number,
    partner: d.partner,
    amount: d.amount?.toString() ?? null,
    note: d.note,
    receiptId: d.receiptId,
    fileCount: files.length,
    cover: files.find((f) => f.hasThumb) ?? files[0] ?? null,
    createdBy: names.get(d.createdById) ?? '',
    createdById: d.createdById,
    createdAt: d.createdAt.toISOString(),
    locked: locked.has(date.slice(0, 7)),
    files,
  };
}

const namesFor = (db: Db, rows: DocRow[]) =>
  userNames(db, [
    ...rows.map((d) => d.createdById),
    ...rows.flatMap((d) => d.files.map((f) => f.createdById)),
  ]);

export async function list(query: {
  period?: string;
  receiptId?: number;
  kind?: DocumentKind;
  q?: string;
}): Promise<DocumentList> {
  if (!query.period && query.receiptId === undefined) throw badRequest('Cần chọn tháng / năm');
  const branchId = await defaultBranchId();
  const q = query.q?.trim();
  const rows = await prisma.document.findMany({
    where: {
      branchId,
      deletedAt: null,
      ...(query.period ? { date: periodRange(query.period) } : {}),
      ...(query.receiptId !== undefined ? { receiptId: query.receiptId } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(q
        ? {
            OR: (['number', 'partner', 'note'] as const).map((f) => ({
              [f]: { contains: q, mode: 'insensitive' as const },
            })),
          }
        : {}),
    },
    include: { files: liveFiles },
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
  });
  const [names, locked] = await Promise.all([namesFor(prisma, rows), lockedMonths(prisma, branchId)]);
  const views = rows.map((d) => {
    const { files: _files, ...summary } = docView(d, names, locked);
    return summary;
  });
  return {
    rows: views,
    totals: DOCUMENT_KINDS.map((kind) => {
      const of = views.filter((v) => v.kind === kind);
      return { kind, count: of.length, amount: sum(of.map((v) => v.amount ?? '0')).toString() };
    }).filter((t) => t.count > 0),
    missingFiles: views.filter((v) => v.fileCount === 0).length,
  };
}

export async function get(id: number, db: Db = prisma): Promise<DocumentDetail> {
  const d = await db.document.findFirst({ where: { id, deletedAt: null }, include: { files: liveFiles } });
  if (!d) throw notFound('Chứng từ');
  return docView(d, await namesFor(db, [d]), await lockedMonths(db, d.branchId));
}

/** Partner names already used (documents + receipt suppliers) for the autocomplete. */
export async function partners(): Promise<string[]> {
  const [docs, receipts] = await Promise.all([
    prisma.document.findMany({
      where: { partner: { not: null }, deletedAt: null },
      distinct: ['partner'],
      select: { partner: true },
    }),
    prisma.receipt.findMany({
      where: { supplier: { not: null } },
      distinct: ['supplier'],
      select: { supplier: true },
    }),
  ]);
  const all = new Set([...docs.map((d) => d.partner!), ...receipts.map((r) => r.supplier!)]);
  return [...all].sort((a, b) => a.localeCompare(b, 'vi'));
}

async function assertReceipt(db: Db, receiptId: number | null) {
  if (receiptId === null) return;
  const r = await db.receipt.findUnique({ where: { id: receiptId }, select: { id: true } });
  if (!r) throw notFound('Phiếu nhập');
}

const data = (input: DocumentInput) => ({
  kind: input.kind,
  date: toDbDate(input.date),
  number: input.number || null,
  partner: input.partner || null,
  amount: input.amount,
  note: input.note || null,
  receiptId: input.receiptId,
});

export async function create(userId: number, input: DocumentInput): Promise<DocumentDetail> {
  const branchId = await defaultBranchId();
  return inTx(async (tx) => {
    await assertReceipt(tx, input.receiptId);
    const d = await tx.document.create({ data: { ...data(input), branchId, createdById: userId } });
    await writeAudit(tx, { entity: 'document', entityId: d.id, action: 'CREATE', after: input, userId });
    return get(d.id, tx);
  });
}

/**
 * The uploader may fix their own document / file for 24 h without a reason; otherwise ADMIN only, with a
 * reason. Returns the reason to write to the audit log.
 */
function assertCanChange(
  user: AuthUser,
  item: { createdById: number; createdAt: string },
  reason: string | undefined,
  what: string,
): string | null {
  const right = changeRight(user, item);
  if (right === 'NO') throw forbidden(`Chỉ người tải lên (trong 24 giờ) hoặc ADMIN mới được ${what}`);
  if (right === 'WITH_REASON' && !reason) throw badRequest('Cần nhập lý do (tối thiểu 5 ký tự)');
  return reason ?? null;
}

export async function update(
  user: AuthUser,
  id: number,
  input: DocumentInput,
  reasonIn?: string,
): Promise<DocumentDetail> {
  const userId = user.id;
  return inTx(async (tx) => {
    const before = await get(id, tx);
    const reason = assertCanChange(user, before, reasonIn, 'sửa chứng từ này');
    await assertPeriodOpen(tx, before.date);
    await assertPeriodOpen(tx, input.date);
    await assertReceipt(tx, input.receiptId);
    await tx.document.update({ where: { id }, data: data(input) });
    const { files: _files, ...beforeFields } = before;
    await writeAudit(tx, {
      entity: 'document',
      entityId: id,
      action: 'UPDATE',
      reason,
      before: beforeFields,
      after: input,
      userId,
    });
    return get(id, tx);
  });
}

/** Soft delete: the row and its files stay (on disk and in the database), just hidden. */
export async function remove(user: AuthUser, id: number, reasonIn?: string) {
  const userId = user.id;
  await inTx(async (tx) => {
    const before = await get(id, tx);
    const reason = assertCanChange(user, before, reasonIn, 'xoá chứng từ này');
    await assertPeriodOpen(tx, before.date);
    await tx.document.update({ where: { id }, data: { deletedAt: new Date(), deletedById: userId } });
    await writeAudit(tx, { entity: 'document', entityId: id, action: 'DELETE', reason, before, userId });
  });
  return { ok: true as const };
}

/** Decode base64 without trusting it: size is checked before allocating the buffer. */
function decode(b64: string, max: number, what: string): Buffer {
  if (Math.floor((b64.length * 3) / 4) > max + 4)
    throw badRequest(`${what} quá lớn (tối đa ${Math.round(max / 1024 / 1024) || 1} MB)`);
  const buf = Buffer.from(b64, 'base64');
  if (buf.length === 0) throw badRequest(`${what} rỗng`);
  if (buf.length > max) throw badRequest(`${what} quá lớn (tối đa ${Math.round(max / 1024 / 1024) || 1} MB)`);
  return buf;
}

export async function addFile(
  userId: number,
  documentId: number,
  upload: FileUpload,
): Promise<DocumentFileDto> {
  const doc = await get(documentId);
  if (doc.fileCount >= MAX_FILES_PER_DOCUMENT)
    throw badRequest(`Mỗi chứng từ tối đa ${MAX_FILES_PER_DOCUMENT} file`);

  const bytes = decode(upload.dataBase64, MAX_FILE_BYTES, 'File');
  const type = detectFileType(bytes);
  if (!type) throw badRequest('Chỉ nhận ảnh (JPG, PNG, WEBP), PDF hoặc XML hoá đơn điện tử');

  let thumb: Buffer | null = null;
  if (type.image && upload.thumbBase64) {
    thumb = decode(upload.thumbBase64, MAX_THUMB_BYTES, 'Ảnh thu nhỏ');
    if (detectFileType(thumb)?.mime !== 'image/jpeg') thumb = null;
  }

  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const dup = await prisma.documentFile.findFirst({
    where: { sha256, deletedAt: null, document: { deletedAt: null } },
    include: { document: true },
  });
  if (dup) {
    const d = dup.document;
    throw conflict(
      'DUPLICATE_FILE',
      `File này đã được lưu ở chứng từ ngày ${fromDbDate(d.date).split('-').reverse().join('/')}` +
        (d.partner ? ` — ${d.partner}` : ''),
      { documentId: d.id },
    );
  }

  // Folder by the document's month: storage/documents/2026/10/<uuid>.jpg — easy to browse by hand too.
  const stem = `${doc.date.slice(0, 4)}/${doc.date.slice(5, 7)}/${randomUUID()}`;
  const rel = `${stem}.${type.ext}`;
  const thumbRel = thumb ? `${stem}.thumb.jpg` : null;
  await storeFile(rel, bytes);
  if (thumbRel) await storeFile(thumbRel, thumb!);

  try {
    const f = await inTx(async (tx) => {
      const row = await tx.documentFile.create({
        data: {
          documentId,
          name: safeFileName(upload.name, type.ext),
          mime: type.mime,
          size: bytes.length,
          path: rel,
          thumbPath: thumbRel,
          sha256,
          createdById: userId,
        },
      });
      await writeAudit(tx, {
        entity: 'document',
        entityId: documentId,
        action: 'ADD_FILE',
        after: { fileId: row.id, name: row.name, mime: row.mime, size: row.size },
        userId,
      });
      return row;
    });
    return fileView(f, await userNames(prisma, [userId]));
  } catch (e) {
    await discardFile(rel);
    if (thumbRel) await discardFile(thumbRel);
    throw e;
  }
}

export async function removeFile(user: AuthUser, documentId: number, fileId: number, reasonIn?: string) {
  const userId = user.id;
  await inTx(async (tx) => {
    const doc = await get(documentId, tx);
    const file = doc.files.find((f) => f.id === fileId);
    if (!file) throw notFound('File');
    const reason = assertCanChange(user, file, reasonIn, 'xoá file này');
    await assertPeriodOpen(tx, doc.date);
    await tx.documentFile.update({ where: { id: fileId }, data: { deletedAt: new Date() } });
    await writeAudit(tx, {
      entity: 'document',
      entityId: documentId,
      action: 'REMOVE_FILE',
      reason,
      before: file,
      userId,
    });
  });
  return { ok: true as const };
}

/** The stored file behind a download (thumbnail when asked and available). */
export async function fileForDownload(fileId: number, thumb: boolean) {
  const f = await prisma.documentFile.findFirst({
    where: { id: fileId, deletedAt: null, document: { deletedAt: null } },
  });
  if (!f) throw notFound('File');
  if (thumb && f.thumbPath) return { path: f.thumbPath, mime: 'image/jpeg', name: f.name };
  return { path: f.path, mime: f.mime, name: f.name };
}
