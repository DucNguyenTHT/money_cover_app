import { initServer } from '@ts-rest/express';
import { inventoryContract } from '../../contracts/inventory.contract';
import { currentUser } from '../../core/auth';
import * as inv from './inventory.service';

const s = initServer();

export const inventoryRouter = s.router(inventoryContract, {
  listReceipts: async ({ query }) => ({ status: 200, body: await inv.listReceipts(query.month) }),
  suppliers: async () => ({ status: 200, body: await inv.suppliers() }),
  getReceipt: async ({ params }) => ({ status: 200, body: await inv.getReceipt(params.id) }),
  createReceipt: async ({ req, body }) => ({
    status: 201,
    body: await inv.createReceipt(currentUser(req).id, body),
  }),
  updateReceipt: async ({ req, params, body }) => ({
    status: 200,
    body: await inv.updateReceipt(currentUser(req).id, params.id, body),
  }),
  deleteReceipt: async ({ req, params, body }) => ({
    status: 200,
    body: await inv.deleteReceipt(currentUser(req).id, params.id, body.reason),
  }),

  listIssues: async ({ query }) => ({ status: 200, body: await inv.listIssues(query.month, query.reason) }),
  getIssue: async ({ params }) => ({ status: 200, body: await inv.getIssue(params.id) }),
  createIssue: async ({ req, body }) => ({
    status: 201,
    body: await inv.createIssue(currentUser(req).id, body),
  }),
  deleteIssue: async ({ req, params, body }) => ({
    status: 200,
    body: await inv.deleteIssue(currentUser(req).id, params.id, body.reason),
  }),

  stock: async () => ({ status: 200, body: await inv.stock() }),
  lots: async ({ query }) => ({
    status: 200,
    body: await inv.lots(query.ingredientId, query.open === 'true'),
  }),
  pending: async () => ({ status: 200, body: await inv.pending() }),
  priceHistory: async ({ query }) => ({ status: 200, body: await inv.priceHistory(query.ingredientId) }),
});
