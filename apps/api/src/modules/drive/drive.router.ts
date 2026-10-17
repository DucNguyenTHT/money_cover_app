import { initServer } from '@ts-rest/express';
import { driveContract } from '../../contracts/drive.contract';
import { currentUser } from '../../core/auth';
import * as drive from './drive.service';

const s = initServer();

export const driveRouter = s.router(driveContract, {
  status: async () => ({ status: 200, body: await drive.status() }),
  connect: async ({ req }) => ({ status: 200, body: await drive.connect(currentUser(req).id) }),
  poll: async ({ req }) => ({ status: 200, body: await drive.poll(currentUser(req).id) }),
  disconnect: async ({ req }) => ({ status: 200, body: await drive.disconnect(currentUser(req).id) }),
  uploadDocuments: async ({ req, body }) => ({
    status: 200,
    body: await drive.uploadDocuments(currentUser(req).id, body.period),
  }),
});
