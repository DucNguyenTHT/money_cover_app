import { prisma } from './db';

let cached: number | null = null;

/** Single-branch for now: every document belongs to the first active branch. */
export async function defaultBranchId(): Promise<number> {
  if (cached !== null) return cached;
  const b = await prisma.branch.findFirst({ where: { active: true }, orderBy: { id: 'asc' } });
  if (!b) throw new Error('Chưa có cơ sở nào — hãy chạy `pnpm db:seed`');
  cached = b.id;
  return cached;
}
