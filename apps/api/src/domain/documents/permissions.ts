// Who may change a document / file: its uploader for a short while (fixing a wrong photo right away),
// ADMIN at any time but then with a reason for the audit log. A locked month blocks everyone.
import type { Role } from '../enums';

/** How long the uploader may delete / edit their own document or file without a reason. */
export const OWN_EDIT_WINDOW_MS = 24 * 3600_000;

export type ChangeRight = 'NO' | 'FREE' | 'WITH_REASON';

export function changeRight(
  user: { id: number; role: Role },
  item: { createdById: number; createdAt: string | Date },
  now = Date.now(),
): ChangeRight {
  const own = item.createdById === user.id && now - new Date(item.createdAt).getTime() < OWN_EDIT_WINDOW_MS;
  if (own) return 'FREE';
  return user.role === 'ADMIN' ? 'WITH_REASON' : 'NO';
}
