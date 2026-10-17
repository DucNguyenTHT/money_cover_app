import { initServer } from '@ts-rest/express';
import { stocktakeContract } from '../../contracts/stocktake.contract';
import { currentUser } from '../../core/auth';
import { redactFor } from '../../core/redact';
import * as stocktake from './stocktake.service';

const s = initServer();

export const stocktakeRouter = s.router(stocktakeContract, {
  list: async ({ req, query }) => ({
    status: 200,
    body: redactFor(currentUser(req).role, await stocktake.list(query.month)),
  }),
  get: async ({ req, params }) => ({
    status: 200,
    body: redactFor(currentUser(req).role, await stocktake.get(params.id)),
  }),
  create: async ({ req, body }) => {
    const u = currentUser(req);
    return { status: 201, body: redactFor(u.role, await stocktake.create(u, body.date, body.note)) };
  },
  update: async ({ req, params, body }) => {
    const u = currentUser(req);
    return { status: 200, body: redactFor(u.role, await stocktake.update(u, params.id, body)) };
  },
  complete: async ({ req, params }) => ({
    status: 200,
    body: await stocktake.complete(currentUser(req), params.id),
  }),
  cancel: async ({ req, params, body }) => ({
    status: 200,
    body: await stocktake.cancel(currentUser(req), params.id, body.reason),
  }),
});
