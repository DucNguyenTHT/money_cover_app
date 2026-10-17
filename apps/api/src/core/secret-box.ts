import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../config/env';

// Small AES-256-GCM wrapper for secrets kept in the database (e.g. the Google refresh token),
// so a stray database dump alone does not hand out access. Key derived from JWT_SECRET.
const key = (purpose: string) => createHash('sha256').update(`${env.JWT_SECRET}:${purpose}`).digest();

export function seal(plain: string, purpose: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(purpose), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

/** null when the secret cannot be opened (JWT_SECRET changed or data tampered with). */
export function open(sealed: string, purpose: string): string | null {
  try {
    const [iv, tag, data] = sealed.split('.').map((p) => Buffer.from(p, 'base64')) as [
      Buffer,
      Buffer,
      Buffer,
    ];
    const d = createDecipheriv('aes-256-gcm', key(purpose), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(data), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}
