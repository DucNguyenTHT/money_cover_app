import 'dotenv/config';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // Integration tests share one database: run files one after another.
    fileParallelism: false,
    globalSetup: ['tests/helpers/global-setup.ts'],
    env: {
      NODE_ENV: 'test',
      // Integration tests never touch the dev database.
      DATABASE_URL: process.env.DATABASE_URL_TEST ?? '',
      // Uploaded test files land in a throw-away folder (see tests/helpers/global-setup.ts).
      UPLOAD_DIR: 'storage/test-documents',
      // Backups go to a throw-away folder and use a fake pg_dump (tests/helpers/fake-pg-dump.mjs).
      BACKUP_DIR: 'storage/test-backups',
      BACKUP_PG_DUMP: 'node tests/helpers/fake-pg-dump.mjs',
      BACKUP_DATABASE_URL: '',
      // Google is mocked in tests/integration/drive.test.ts; these only make the feature "configured".
      GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'test-secret',
    },
  },
});
