import { initServer } from '@ts-rest/express';
import { venueContract } from '../../contracts/venue.contract';
import { currentUser } from '../../core/auth';
import * as venue from './venue.service';

const s = initServer();

export const venueRouter = s.router(venueContract, {
  listAreas: async () => ({ status: 200, body: await venue.listAreas() }),
  createArea: async ({ req, body }) => ({
    status: 201,
    body: await venue.createArea(currentUser(req).id, body),
  }),
  updateArea: async ({ req, params, body }) => ({
    status: 200,
    body: await venue.updateArea(currentUser(req).id, params.id, body),
  }),
  createTable: async ({ req, body }) => ({
    status: 201,
    body: await venue.createTable(currentUser(req).id, body),
  }),
  updateTable: async ({ req, params, body }) => ({
    status: 200,
    body: await venue.updateTable(currentUser(req).id, params.id, body),
  }),

  listDeliveryApps: async () => ({ status: 200, body: await venue.listApps() }),
  createDeliveryApp: async ({ req, body }) => ({
    status: 201,
    body: await venue.createApp(currentUser(req).id, body),
  }),
  updateDeliveryApp: async ({ req, params, body }) => ({
    status: 200,
    body: await venue.updateApp(currentUser(req).id, params.id, body),
  }),

  listPrinters: async () => ({ status: 200, body: await venue.listPrinters() }),
  createPrinter: async ({ req, body }) => ({
    status: 201,
    body: await venue.createPrinter(currentUser(req).id, body),
  }),
  updatePrinter: async ({ req, params, body }) => ({
    status: 200,
    body: await venue.updatePrinter(currentUser(req).id, params.id, body),
  }),
  testPrinter: async ({ params }) => ({ status: 200, body: await venue.testPrinter(params.id) }),
});
