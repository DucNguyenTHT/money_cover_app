import { initServer } from '@ts-rest/express';
import { cashContract } from '../../contracts/cash.contract';
import { currentUser } from '../../core/auth';
import * as cash from './cash.service';

const s = initServer();

export const cashRouter = s.router(cashContract, {
  list: async ({ query }) => ({ status: 200, body: await cash.list(query.from, query.to) }),
  create: async ({ req, body }) => ({ status: 201, body: await cash.create(currentUser(req), body) }),
  cancel: async ({ req, params, body }) => ({
    status: 200,
    body: await cash.cancel(currentUser(req), params.id, body.reason),
  }),
});
