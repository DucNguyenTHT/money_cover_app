// Recognise an uploaded invoice file from its bytes (never from the name or the client's mime type).

export type DocFileType = { mime: string; ext: string; image: boolean };

const JPEG: DocFileType = { mime: 'image/jpeg', ext: 'jpg', image: true };
const PNG: DocFileType = { mime: 'image/png', ext: 'png', image: true };
const WEBP: DocFileType = { mime: 'image/webp', ext: 'webp', image: true };
const PDF: DocFileType = { mime: 'application/pdf', ext: 'pdf', image: false };
const XML: DocFileType = { mime: 'application/xml', ext: 'xml', image: false };

/** Largest file kept (an e-invoice PDF is usually < 1 MB; photos are compressed in the browser first). */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_THUMB_BYTES = 256 * 1024;
export const MAX_FILES_PER_DOCUMENT = 20;

const starts = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** Text e-invoices (XML) must be UTF-8 and start with "<" after an optional BOM / whitespace. */
function looksLikeXml(b: Uint8Array): boolean {
  let i = starts(b, [0xef, 0xbb, 0xbf]) ? 3 : 0;
  while (i < b.length && (b[i] === 0x20 || b[i] === 0x09 || b[i] === 0x0a || b[i] === 0x0d)) i++;
  if (b[i] !== 0x3c) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(b);
    return true;
  } catch {
    return false;
  }
}

export function detectFileType(b: Uint8Array): DocFileType | null {
  if (starts(b, [0xff, 0xd8, 0xff])) return JPEG;
  if (starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return PNG;
  if (starts(b, ascii('RIFF')) && starts(b, ascii('WEBP'), 8)) return WEBP;
  if (starts(b, ascii('%PDF-'))) return PDF;
  if (looksLikeXml(b)) return XML;
  return null;
}

/** Keep a readable original name for downloads: no path parts, no control characters, max 120 chars. */
export function safeFileName(name: string, ext: string): string {
  const base = [...(name.split(/[\\/]/).pop() ?? '')]
    .filter((ch) => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) !== 0x7f && !'"<>|:*?'.includes(ch))
    .join('')
    .trim()
    .slice(0, 120);
  const stem = base.replace(/\.[^.]*$/, '') || 'chung-tu';
  return `${stem}.${ext}`;
}
