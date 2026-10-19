import { initServer } from '@ts-rest/express';
import { backupsContract } from '../../contracts/backups.contract';
import { currentUser } from '../../core/auth';
import * as backup from './backup.service';

const s = initServer();

export const backupsRouter = s.router(backupsContract, {
  status: async () => ({ status: 200, body: await backup.status() }),
  run: async ({ req }) => ({ status: 200, body: await backup.run('MANUAL', currentUser(req).id) }),
});
