// Invoice photos / e-invoice files: compress in the browser, upload one by one, fetch back with the token.
import { useQuery } from '@tanstack/react-query';
import { MAX_FILE_BYTES } from '@ketoan/api/domain';
import type { DocumentFileDto } from '@ketoan/api/contracts';
import { client, errorMessage, ok, tokenStore } from './api-client';

/** Long side of a stored photo: enough to read small print on a VAT invoice, ~300–500 KB as JPEG. */
const PHOTO_MAX_SIDE = 2200;
const THUMB_MAX_SIDE = 360;

export const ACCEPT_FILES = 'image/*,.heic,.heif,application/pdf,.pdf,.xml,text/xml,application/xml';

export const fileKind = (mime: string) =>
  mime.startsWith('image/') ? 'image' : mime === 'application/pdf' ? 'pdf' : 'xml';

const isImage = (f: File) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name);

async function draw(bmp: ImageBitmap, maxSide: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff'; // transparent PNGs become white, not black, as JPEG
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Không nén được ảnh'))), 'image/jpeg', quality),
  );
}

/** Photo → upright JPEG (EXIF rotation applied) + small preview. */
async function preparePhoto(file: File): Promise<{ data: Blob; thumb: Blob }> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('Máy này không đọc được ảnh, hãy chụp lại hoặc chọn ảnh JPG/PNG');
  }
  try {
    const data = await draw(bmp, PHOTO_MAX_SIDE, 0.82);
    const thumb = await draw(bmp, THUMB_MAX_SIDE, 0.7);
    // An already-small JPEG is kept as is (no second round of quality loss).
    const keep =
      file.type === 'image/jpeg' &&
      file.size <= data.size &&
      Math.max(bmp.width, bmp.height) <= PHOTO_MAX_SIDE;
    return { data: keep ? file : data, thumb };
  } finally {
    bmp.close();
  }
}

const toBase64 = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new Error('Không đọc được file'));
    r.readAsDataURL(b);
  });

export interface UploadResult {
  uploaded: number;
  failed: { name: string; message: string }[];
}

/** Upload files to a document one after another; a bad file never stops the rest. */
export async function uploadFiles(
  documentId: number,
  files: File[],
  onProgress?: (done: number, total: number) => void,
): Promise<UploadResult> {
  const result: UploadResult = { uploaded: 0, failed: [] };
  for (const [i, file] of files.entries()) {
    onProgress?.(i, files.length);
    try {
      let data: Blob = file;
      let thumb: Blob | null = null;
      if (isImage(file)) ({ data, thumb } = await preparePhoto(file));
      if (data.size > MAX_FILE_BYTES) throw new Error('File lớn hơn 10 MB');
      ok(
        await client.documents.addFile({
          params: { id: documentId },
          body: {
            name: file.name,
            dataBase64: await toBase64(data),
            thumbBase64: thumb ? await toBase64(thumb) : null,
          },
        }),
      );
      result.uploaded++;
    } catch (e) {
      result.failed.push({ name: file.name, message: errorMessage(e) });
    }
  }
  onProgress?.(files.length, files.length);
  return result;
}

/** First invoice photo of a stock receipt: file a "Mua vào" document for it, then upload. */
export async function attachToReceipt(
  receipt: { id: number; date: string; supplier: string | null; total: string },
  files: File[],
  onProgress?: (done: number, total: number) => void,
): Promise<UploadResult> {
  const doc = ok(
    await client.documents.create({
      body: {
        kind: 'PURCHASE',
        date: receipt.date,
        number: null,
        partner: receipt.supplier,
        amount: receipt.total,
        note: null,
        receiptId: receipt.id,
      },
    }),
  );
  return uploadFiles(doc.id, files, onProgress);
}

async function fetchFile(id: number, thumb: boolean): Promise<Blob> {
  const res = await fetch(`/api/document-files/${id}${thumb ? '?thumb=1' : ''}`, {
    headers: { authorization: `Bearer ${tokenStore.get()}` },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? 'Không tải được file');
  }
  return res.blob();
}

/** Blob URL for a stored file (cached: stored files never change). */
export function useFileUrl(id: number | null, thumb = false) {
  return useQuery({
    queryKey: ['document-file', id, thumb],
    enabled: id !== null,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    queryFn: async () => {
      const blob = await fetchFile(id!, thumb);
      return { url: URL.createObjectURL(blob), blob };
    },
  });
}

export async function downloadFile(f: DocumentFileDto) {
  const blob = await fetchFile(f.id, false);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = f.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const fileSize = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
