import type { Prisma } from '@prisma/client';
import { prisma, type Db } from '../../core/db';
import { writeAudit } from '../../core/audit';
import { defaultBranchId } from '../../core/branch';
import { settingsSchema, type Settings } from '../../contracts/settings.contract';
import { DEFAULT_SETTINGS } from './defaults';
import { businessDateOf } from '../../domain/business-date';

/** All settings, typed, with defaults filled in for keys not stored yet. */
export async function getSettings(db: Db = prisma): Promise<Settings> {
  const rows = await db.setting.findMany();
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const merged = { ...DEFAULT_SETTINGS, ...stored };
  const parsed = settingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

/** Today's business date ("YYYY-MM-DD"), honouring business_day_start. */
export async function businessToday(db: Db = prisma, now = new Date()): Promise<string> {
  const s = await getSettings(db);
  return businessDateOf(now, s.business_day_start);
}

async function branchView() {
  const b = await prisma.branch.findUniqueOrThrow({ where: { id: await defaultBranchId() } });
  return { name: b.name, address: b.address ?? '', phone: b.phone ?? '' };
}

export async function getView() {
  return { branch: await branchView(), settings: await getSettings() };
}

export async function update(
  userId: number,
  input: { branch?: { name: string; address: string; phone: string }; settings?: Partial<Settings> },
) {
  const before = await getView();
  await prisma.$transaction(async (tx) => {
    if (input.branch) {
      await tx.branch.update({ where: { id: await defaultBranchId() }, data: input.branch });
    }
    for (const [key, value] of Object.entries(input.settings ?? {})) {
      if (value === undefined) continue;
      const v = value as Prisma.InputJsonValue;
      await tx.setting.upsert({ where: { key }, update: { value: v }, create: { key, value: v } });
    }
    await writeAudit(tx, {
      entity: 'settings',
      entityId: 'all',
      action: 'UPDATE',
      before,
      after: input,
      userId,
    });
  });
  return getView();
}
