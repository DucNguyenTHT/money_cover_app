import { initServer } from '@ts-rest/express';
import { suppliersContract } from '../../contracts/suppliers.contract';
import { currentUser } from '../../core/auth';
import * as suppliers from './suppliers.service';

const s = initServer();

export const suppliersRouter = s.router(suppliersContract, {
  list: async () => ({ status: 200, body: await suppliers.list() }),
  create: async ({ req, body }) => ({
    status: 201,
    body: await suppliers.save(currentUser(req).id, null, body),
  }),
  update: async ({ req, params, body }) => ({
    status: 200,
    body: await suppliers.save(currentUser(req).id, params.id, body),
  }),
  ledger: async ({ params }) => ({ status: 200, body: await suppliers.ledger(params.id) }),
  pay: async ({ req, params, body }) => ({
    status: 201,
    body: await suppliers.pay(currentUser(req), params.id, body),
  }),
  cancelPayment: async ({ req, params, body }) => ({
    status: 200,
    body: await suppliers.cancelPayment(currentUser(req), params.id, body.reason),
  }),
});
