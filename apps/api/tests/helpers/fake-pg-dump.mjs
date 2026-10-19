// Stand-in for pg_dump in the integration tests (BACKUP_PG_DUMP in vitest.config.ts): writes a small file
// that starts like a custom-format dump. FAKE_PG_DUMP_FAIL=1 makes it fail the way pg_dump does.
import { Buffer } from 'node:buffer';
import process from 'node:process';

if (process.env.FAKE_PG_DUMP_FAIL) {
  process.stderr.write('pg_dump: error: connection to server failed\n');
  process.exit(1);
}
const dbname = process.argv.find((a) => a.startsWith('--dbname=')) ?? '';
process.stdout.write(Buffer.concat([Buffer.from('PGDMP'), Buffer.from(`${dbname}\n`.repeat(40))]));
