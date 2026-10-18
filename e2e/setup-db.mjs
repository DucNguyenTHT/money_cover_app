// Fresh database for one e2e run: drop + migrate + seed, then a ready ADMIN account (password set, PIN set).
// Run by the Playwright web server before the API starts (see playwright.config.ts) — never touches the dev DB.
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const api = fileURLToPath(new URL('../apps/api', import.meta.url));
const env = { ...process.env };
if (!/ketoan_e2e/.test(env.DATABASE_URL ?? '')) {
  console.error(`setup-db: refusing to reset a database that is not ketoan_e2e (${env.DATABASE_URL})`);
  process.exit(1);
}
const run = (cmd) => execSync(cmd, { cwd: api, env, stdio: 'inherit' });

// --skip-generate: the dev API may be running and holding the generated client (EPERM on Windows).
run('pnpm exec prisma migrate reset --force --skip-seed --skip-generate');
run('pnpm exec tsx prisma/seed/index.ts');
run(`pnpm exec tsx scripts/dev-user.ts ${env.E2E_USER} ${env.E2E_PASS} ADMIN 2580`);
