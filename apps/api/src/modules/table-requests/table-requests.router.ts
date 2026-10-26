import { initServer } from '@ts-rest/express';
import { guestContract, tableRequestsContract } from '../../contracts/table-requests.contract';
import { currentUser } from '../../core/auth';
import * as requests from './table-requests.service';

const s = initServer();

/** Guests' phones (no login). */
export const guestRouter = s.router(guestContract, {
  menu: async ({ params }) => ({ status: 200, body: await requests.menu(params.token) }),
  send: async ({ req, params, body }) => ({
    status: 201,
    body: await requests.send(params.token, body, req.ip ?? null),
  }),
  mine: async ({ params, query }) => ({
    status: 200,
    body: await requests.mine(params.token, query.clientId),
  }),
});

export const tableRequestsRouter = s.router(tableRequestsContract, {
  list: async () => ({ status: 200, body: await requests.list() }),
  accept: async ({ req, params }) => ({
    status: 200,
    body: await requests.accept(currentUser(req), params.id),
  }),
  reject: async ({ req, params, body }) => ({
    status: 200,
    body: await requests.reject(currentUser(req), params.id, body.reason),
  }),
  qrCodes: async ({ req, body }) => ({
    status: 200,
    body: await requests.qrCodes(currentUser(req), body.renewTableId),
  }),
});
