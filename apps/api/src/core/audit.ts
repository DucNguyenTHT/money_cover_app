import type { Prisma } from '@prisma/client';
import type { Db } from './db';

export interface AuditEntry {
  entity: string;
  entityId: string | number;
  action: string;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
  userId?: number | null;
  approvedById?: number | null;
}

const toJson = (v: unknown): Prisma.InputJsonValue | undefined =>
  v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue);

/** Write one audit row; call inside the same transaction as the change it records. */
export async function writeAudit(db: Db, e: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      entity: e.entity,
      entityId: String(e.entityId),
      action: e.action,
      reason: e.reason ?? null,
      before: toJson(e.before),
      after: toJson(e.after),
      userId: e.userId ?? null,
      approvedById: e.approvedById ?? null,
    },
  });
}
