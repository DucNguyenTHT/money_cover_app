import { initServer } from '@ts-rest/express';
import { usersContract } from '../../contracts/users.contract';
import { currentUser } from '../../core/auth';
import * as users from './users.service';

const s = initServer();

export const usersRouter = s.router(usersContract, {
  list: async () => ({ status: 200, body: await users.list() }),
  approvers: async () => ({ status: 200, body: await users.approvers() }),
  create: async ({ req, body }) => ({ status: 201, body: await users.create(currentUser(req).id, body) }),
  update: async ({ req, params, body }) => ({
    status: 200,
    body: await users.update(currentUser(req).id, params.id, body),
  }),
  resetPassword: async ({ req, params, body }) => ({
    status: 200,
    body: await users.resetPassword(currentUser(req).id, params.id, body.newPassword, body.reason),
  }),
  resetPin: async ({ req, params, body }) => ({
    status: 200,
    body: await users.resetPin(currentUser(req).id, params.id, body.reason),
  }),
});
