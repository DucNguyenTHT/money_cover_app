// Integration test harness: real Express app on a random port + typed ts-rest client + DB helpers.
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import bcrypt from 'bcryptjs';
import type { Role, Station } from '@prisma/client';
import { initClient } from '@ts-rest/core';
import { createApp } from '../../src/app';
import { prisma } from '../../src/core/db';
import { api } from '../../src/contracts';
import { DEFAULT_SETTINGS } from '../../src/modules/settings/defaults';

let server: Server | null = null;
let baseUrl = '';

/** Ports fetch refuses ("bad ports"); Windows may hand them out as random ports (dynamic range from 1024). */
const FETCH_BAD_PORTS = new Set([
  1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697,
  10080,
]);

export async function startServer() {
  if (server) return;
  for (;;) {
    server = createApp().listen(0);
    await new Promise((r) => server!.once('listening', r));
    const port = (server.address() as AddressInfo).port;
    if (!FETCH_BAD_PORTS.has(port)) {
      baseUrl = `http://127.0.0.1:${port}`;
      return;
    }
    await new Promise((r) => server!.close(r));
  }
}

export async function stopServer() {
  await new Promise((r) => server?.close(r));
  server = null;
  await prisma.$disconnect();
}

/** Base URL of the running test server (for routes outside the ts-rest contract). */
export const serverUrl = () => baseUrl;

/** Typed API client, optionally authenticated. */
export const clientFor = (token?: string) =>
  initClient(api, { baseUrl, baseHeaders: token ? { authorization: `Bearer ${token}` } : {} });

/** Empty every table (keeps the migrations table) and insert the minimum: branch + settings. */
export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(
    `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
  await prisma.branch.create({ data: { code: 'CS01', name: 'Quán test' } });
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.setting.create({ data: { key, value: value as never } });
  }
}

export const PASSWORD = 'matkhau123';

/** Create a ready-to-use user (password already changed) and return a token for it. */
export async function makeUser(opts: { username: string; role: Role; station?: Station; pin?: string }) {
  const user = await prisma.user.create({
    data: {
      username: opts.username,
      fullName: opts.username.toUpperCase(),
      role: opts.role,
      station: opts.station ?? null,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      pinHash: opts.pin ? await bcrypt.hash(opts.pin, 4) : null,
      mustChangePassword: false,
    },
  });
  const res = await clientFor().auth.login({ body: { username: opts.username, password: PASSWORD } });
  if (res.status !== 200) throw new Error('login failed in test harness');
  return { user, token: res.body.token, client: clientFor(res.body.token) };
}
