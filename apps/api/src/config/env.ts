import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET phải dài ít nhất 32 ký tự'),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  TZ: z.string().default('Asia/Ho_Chi_Minh'),
  /** Where scanned invoices are stored (relative paths resolve from the API's working directory). */
  UPLOAD_DIR: z.string().default('storage/documents'),
  /** Where the nightly database dumps are written (prod: bind mount ./backups). */
  BACKUP_DIR: z.string().default('backups'),
  /**
   * Command that runs pg_dump (arguments are appended). Default: pg_dump installed next to the API (prod image).
   * Dev without a local pg_dump: "docker exec -i ketoannoibo-db-1 pg_dump" + BACKUP_DATABASE_URL.
   */
  BACKUP_PG_DUMP: z.string().default('pg_dump'),
  /** Database URL as seen by BACKUP_PG_DUMP (default DATABASE_URL). */
  BACKUP_DATABASE_URL: z.string().optional(),
  /** Google OAuth client of type "TVs and Limited Input devices" (docs/setup-google-drive.md). Optional. */
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Biến môi trường không hợp lệ:\n', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
