import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import 'dotenv/config';

const TEST_UPLOADS = 'storage/test-documents';

/** Bring the test database schema up to date once before all test files. */
export default function setup() {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST chưa được đặt trong apps/api/.env');
  execSync('pnpm exec prisma migrate deploy', { stdio: 'pipe', env: { ...process.env, DATABASE_URL: url } });
  rmSync(TEST_UPLOADS, { recursive: true, force: true });
  return () => rmSync(TEST_UPLOADS, { recursive: true, force: true });
}
