import { initServer } from '@ts-rest/express';
import { einvoiceContract } from '../../contracts/einvoice.contract';
import { currentUser } from '../../core/auth';
import * as einvoice from './einvoice.service';

const s = initServer();

export const einvoiceRouter = s.router(einvoiceContract, {
  config: async () => ({ status: 200, body: await einvoice.config() }),
  posInfo: async () => ({ status: 200, body: await einvoice.posInfo() }),
  saveConfig: async ({ req, body }) => ({
    status: 200,
    body: await einvoice.saveConfig(currentUser(req).id, body),
  }),
  clear: async ({ req }) => ({ status: 200, body: await einvoice.clear(currentUser(req).id) }),
  accounts: async ({ body }) => ({ status: 200, body: await einvoice.accounts(body) }),
  list: async ({ query }) => ({ status: 200, body: await einvoice.list(query.from, query.to, query.status) }),
  issueForOrder: async ({ req, params, body }) => ({
    status: 200,
    body: await einvoice.issueForOrder(currentUser(req), params.orderId, body.buyer),
  }),
  retry: async ({ req, params }) => ({
    status: 200,
    body: await einvoice.retry(currentUser(req), params.id),
  }),
  process: async () => ({ status: 200, body: await einvoice.processDue() }),
});
