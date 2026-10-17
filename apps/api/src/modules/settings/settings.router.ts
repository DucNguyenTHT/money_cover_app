import { initServer } from '@ts-rest/express';
import { settingsContract } from '../../contracts/settings.contract';
import { currentUser } from '../../core/auth';
import * as settings from './settings.service';

const s = initServer();

export const settingsRouter = s.router(settingsContract, {
  get: async () => ({ status: 200, body: await settings.getView() }),
  update: async ({ req, body }) => ({ status: 200, body: await settings.update(currentUser(req).id, body) }),
});
