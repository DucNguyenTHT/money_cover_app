import { initServer } from '@ts-rest/express';
import { dayClosingContract, kitchenContract, ordersContract } from '../../contracts/orders.contract';
import { currentUser } from '../../core/auth';
import { redactFor } from '../../core/redact';
import * as orders from './orders.service';
import * as kitchen from './kitchen.service';
import * as dayClosing from './day-closing.service';

const s = initServer();

export const ordersRouter = s.router(ordersContract, {
  floor: async ({ req }) => ({ status: 200, body: redactFor(currentUser(req).role, await orders.floor()) }),
  list: async ({ req, query }) => ({
    status: 200,
    body: redactFor(currentUser(req).role, await orders.list(query)),
  }),
  get: async ({ req, params }) => ({
    status: 200,
    body: redactFor(currentUser(req).role, await orders.getOrder(params.id)),
  }),
  bill: async ({ req, params }) => ({
    status: 200,
    body: redactFor(currentUser(req).role, await orders.bill(params.id)),
  }),
  open: async ({ req, body }) => {
    const u = currentUser(req);
    return { status: 201, body: redactFor(u.role, await orders.open(u, body)) };
  },
  update: async ({ req, params, body }) => ({
    status: 200,
    body: redactFor(currentUser(req).role, await orders.update(currentUser(req), params.id, body)),
  }),
  redeemPoints: async ({ req, params, body }) => {
    const u = currentUser(req);
    return {
      status: 200,
      body: redactFor(u.role, await orders.redeemPoints(u, params.id, body.version, body.points)),
    };
  },
  addItems: async ({ req, params, body }) => ({
    status: 200,
    body: redactFor(currentUser(req).role, await orders.addItems(params.id, body.version, body.items)),
  }),
  updateItem: async ({ req, params, body }) => {
    const u = currentUser(req);
    return {
      status: 200,
      body: redactFor(u.role, await orders.updateItem(u, params.id, params.itemId, body)),
    };
  },
  removeItem: async ({ req, params, body }) => ({
    status: 200,
    body: redactFor(currentUser(req).role, await orders.removeItem(params.id, params.itemId, body.version)),
  }),
  cancelItem: async ({ req, params, body }) => {
    const u = currentUser(req);
    return {
      status: 200,
      body: redactFor(u.role, await orders.cancelItem(u, params.id, params.itemId, body)),
    };
  },
  sendKitchen: async ({ req, params, body }) => ({
    status: 200,
    body: redactFor(currentUser(req).role, await orders.sendKitchen(params.id, body.version)),
  }),
  discount: async ({ req, params, body }) => {
    const u = currentUser(req);
    return { status: 200, body: redactFor(u.role, await orders.discount(u, params.id, body)) };
  },
  move: async ({ req, params, body }) => {
    const u = currentUser(req);
    return {
      status: 200,
      body: redactFor(u.role, await orders.move(u, params.id, body.version, body.tableId)),
    };
  },
  merge: async ({ req, params, body }) => {
    const u = currentUser(req);
    return {
      status: 200,
      body: redactFor(u.role, await orders.merge(u, params.id, body.version, body.targetOrderId)),
    };
  },
  split: async ({ req, params, body }) => {
    const u = currentUser(req);
    return { status: 200, body: redactFor(u.role, await orders.split(u, params.id, body)) };
  },
  print: async ({ params, body }) => ({ status: 200, body: await orders.print(params.id, body.kind) }),
  pay: async ({ req, params, body }) => {
    const u = currentUser(req);
    return { status: 200, body: redactFor(u.role, await orders.pay(u, params.id, body)) };
  },
  cancel: async ({ req, params, body }) => {
    const u = currentUser(req);
    return { status: 200, body: redactFor(u.role, await orders.cancel(u, params.id, body)) };
  },
  duplicate: async ({ req, params }) => {
    const u = currentUser(req);
    return { status: 201, body: redactFor(u.role, await orders.duplicate(u, params.id)) };
  },
});

export const kitchenRouter = s.router(kitchenContract, {
  queue: async ({ req, query }) => ({
    status: 200,
    body: await kitchen.queue(currentUser(req), query.station),
  }),
  setStatus: async ({ req, params, body }) => ({
    status: 200,
    body: await kitchen.setStatus(currentUser(req), params.itemId, body.status),
  }),
  doneAll: async ({ req, body }) => ({
    status: 200,
    body: await kitchen.doneAll(currentUser(req), body.station),
  }),
});

export const dayClosingRouter = s.router(dayClosingContract, {
  preview: async ({ params }) => ({ status: 200, body: await dayClosing.preview(params.date) }),
  close: async ({ req, params, body }) => ({
    status: 200,
    body: await dayClosing.close(currentUser(req), params.date, body.countedCash, body.note),
  }),
  list: async ({ query }) => ({ status: 200, body: await dayClosing.list(query.month) }),
});
