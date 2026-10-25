import { initServer } from '@ts-rest/express';
import { customersContract } from '../../contracts/customers.contract';
import { currentUser } from '../../core/auth';
import * as customers from './customers.service';

const s = initServer();

export const customersRouter = s.router(customersContract, {
  list: async ({ query }) => ({ status: 200, body: await customers.list(query) }),
  get: async ({ params }) => ({ status: 200, body: await customers.get(params.id) }),
  create: async ({ req, body }) => ({ status: 201, body: await customers.create(currentUser(req), body) }),
  update: async ({ req, params, body }) => ({
    status: 200,
    body: await customers.update(currentUser(req), params.id, body),
  }),
  adjustPoints: async ({ req, params, body }) => ({
    status: 200,
    body: await customers.adjustPoints(currentUser(req), params.id, body.points, body.reason),
  }),
});
