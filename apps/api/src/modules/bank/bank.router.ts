import { initServer } from '@ts-rest/express';
import { bankContract } from '../../contracts/bank.contract';
import { currentUser } from '../../core/auth';
import * as bank from './bank.service';

const s = initServer();

export const bankRouter = s.router(bankContract, {
  status: async () => ({ status: 200, body: await bank.status() }),
  saveConfig: async ({ req, body }) => ({
    status: 200,
    body: await bank.saveConfig(currentUser(req).id, body),
  }),
  clear: async ({ req }) => ({ status: 200, body: await bank.clear(currentUser(req).id) }),
  sync: async () => ({ status: 200, body: await bank.sync() }),
  watch: async ({ body }) => ({ status: 200, body: await bank.watch(body.orderId, body.amount) }),
  list: async ({ query }) => ({ status: 200, body: await bank.list(query.from, query.to, query.filter) }),
  unverified: async ({ query }) => ({ status: 200, body: await bank.transferOrders(query.from, query.to) }),
  match: async ({ req, params, body }) => ({
    status: 200,
    body: await bank.match(currentUser(req), params.id, body.orderCode),
  }),
  unmatch: async ({ req, params, body }) => ({
    status: 200,
    body: await bank.unmatch(currentUser(req), params.id, body.reason),
  }),
  ignore: async ({ req, params, body }) => ({
    status: 200,
    body: await bank.ignore(currentUser(req), params.id, body.reason),
  }),
  unignore: async ({ req, params }) => ({
    status: 200,
    body: await bank.unignore(currentUser(req), params.id),
  }),
});
