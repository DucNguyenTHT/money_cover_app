import { initServer } from '@ts-rest/express';
import { authContract } from '../../contracts/auth.contract';
import { currentUser } from '../../core/auth';
import * as auth from './auth.service';

const s = initServer();

export const authRouter = s.router(authContract, {
  login: async ({ body }) => ({ status: 200, body: await auth.login(body.username, body.password) }),
  me: async ({ req }) => ({ status: 200, body: await auth.me(currentUser(req).id) }),
  changePassword: async ({ req, body }) => ({
    status: 200,
    body: await auth.changePassword(currentUser(req).id, body.currentPassword, body.newPassword),
  }),
  setPin: async ({ req, body }) => ({
    status: 200,
    body: await auth.setPin(currentUser(req).id, body.currentPassword, body.pin),
  }),
});
