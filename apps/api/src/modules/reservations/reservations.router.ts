import { initServer } from '@ts-rest/express';
import { reservationsContract } from '../../contracts/reservations.contract';
import { currentUser } from '../../core/auth';
import * as reservations from './reservations.service';

const s = initServer();

export const reservationsRouter = s.router(reservationsContract, {
  list: async ({ query }) => ({ status: 200, body: await reservations.list(query.from, query.to) }),
  create: async ({ req, body }) => ({ status: 201, body: await reservations.create(currentUser(req), body) }),
  update: async ({ req, params, body }) => ({
    status: 200,
    body: await reservations.update(currentUser(req), params.id, body),
  }),
  cancel: async ({ req, params, body }) => ({
    status: 200,
    body: await reservations.cancel(currentUser(req), params.id, body),
  }),
});
