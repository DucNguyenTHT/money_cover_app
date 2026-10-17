import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env';

/** Root folder of uploaded documents (bind-mounted to the host in production so backups can copy it). */
export const uploadRoot = () => path.resolve(env.UPLOAD_DIR);

/** Absolute path of a stored file; refuses anything that would escape the upload folder. */
export function storedPath(rel: string): string {
  const root = uploadRoot();
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(root + path.sep)) throw new Error(`Đường dẫn file không hợp lệ: ${rel}`);
  return abs;
}

/** Write atomically (temp file + rename) so a crash never leaves a half-written invoice. */
export async function storeFile(rel: string, data: Buffer): Promise<void> {
  const abs = storedPath(rel);
  await mkdir(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp`;
  await writeFile(tmp, data, { flag: 'wx' });
  await rename(tmp, abs);
}

/** Only used to roll back a file whose database row could not be written. */
export async function discardFile(rel: string): Promise<void> {
  await rm(storedPath(rel), { force: true });
}
