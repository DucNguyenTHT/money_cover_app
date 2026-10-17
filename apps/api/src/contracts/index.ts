// Public entry for the web app (`@ketoan/api/contracts`): API contract, schemas and socket event types.
import { initContract } from '@ts-rest/core';
import { authContract } from './auth.contract';
import { usersContract } from './users.contract';
import { settingsContract } from './settings.contract';
import { catalogContract } from './catalog.contract';
import { venueContract } from './venue.contract';
import { inventoryContract } from './inventory.contract';
import { menuContract } from './menu.contract';
import { pricingContract } from './pricing.contract';
import { overheadsContract } from './overheads.contract';
import { importsContract } from './imports.contract';
import { dayClosingContract, kitchenContract, ordersContract } from './orders.contract';
import { stocktakeContract } from './stocktake.contract';
import { reportsContract } from './reports.contract';
import { documentsContract } from './documents.contract';
import { driveContract } from './drive.contract';

const c = initContract();

export const api = c.router({
  auth: authContract,
  users: usersContract,
  settings: settingsContract,
  catalog: catalogContract,
  venue: venueContract,
  inventory: inventoryContract,
  menu: menuContract,
  pricing: pricingContract,
  overheads: overheadsContract,
  imports: importsContract,
  orders: ordersContract,
  kitchen: kitchenContract,
  dayClosing: dayClosingContract,
  stocktake: stocktakeContract,
  reports: reportsContract,
  documents: documentsContract,
  drive: driveContract,
});

export type Api = typeof api;
export * from './common';
export * from './socket-events';
export * from './users.contract';
export * from './settings.contract';
export * from './catalog.contract';
export * from './venue.contract';
export * from './inventory.contract';
export * from './menu.contract';
export * from './pricing.contract';
export * from './overheads.contract';
export * from './imports.contract';
export * from './orders.contract';
export * from './stocktake.contract';
export * from './reports.contract';
export * from './documents.contract';
export * from './drive.contract';
