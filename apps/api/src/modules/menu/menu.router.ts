import { initServer } from '@ts-rest/express';
import { menuContract } from '../../contracts/menu.contract';
import { pricingContract } from '../../contracts/pricing.contract';
import { overheadsContract } from '../../contracts/overheads.contract';
import { currentUser } from '../../core/auth';
import { redactFor } from '../../core/redact';
import * as menu from './menu.service';
import * as pricing from '../pricing/pricing.service';
import * as overheads from '../overheads/overheads.service';

const s = initServer();

export const menuRouter = s.router(menuContract, {
  listCategories: async () => ({ status: 200, body: await menu.listCategories() }),
  createCategory: async ({ req, body }) => ({
    status: 201,
    body: await menu.saveCategory(currentUser(req).id, null, body),
  }),
  updateCategory: async ({ req, params, body }) => ({
    status: 200,
    body: await menu.saveCategory(currentUser(req).id, params.id, body),
  }),
  listDishes: async ({ req, query }) => ({
    status: 200,
    body: redactFor(currentUser(req).role, await menu.listDishes(query.date)),
  }),
  getDish: async ({ params }) => ({ status: 200, body: await menu.getDish(params.id) }),
  createDish: async ({ req, body }) => ({
    status: 201,
    body: await menu.createDish(currentUser(req).id, body),
  }),
  updateDish: async ({ req, params, body }) => ({
    status: 200,
    body: await menu.updateDish(currentUser(req).id, params.id, body),
  }),
  setPrice: async ({ req, params, body }) => ({
    status: 200,
    body: await menu.setPrice(currentUser(req).id, params.id, body),
  }),
  saveRecipe: async ({ req, params, body }) => ({
    status: 200,
    body: await menu.saveRecipe(currentUser(req).id, params.id, body),
  }),
  deleteRecipe: async ({ req, params, body }) => ({
    status: 200,
    body: await menu.deleteRecipe(currentUser(req).id, params.id, params.recipeId, body.reason),
  }),
  setAvailability: async ({ req, params, body }) => ({
    status: 200,
    body: await menu.setAvailability(currentUser(req).id, params.id, body.soldOut),
  }),
});

export const pricingRouter = s.router(pricingContract, {
  list: async ({ query }) => ({ status: 200, body: await pricing.list(query.appId) }),
  detail: async ({ params, query }) => ({ status: 200, body: await pricing.detail(params.id, query.appId) }),
  alerts: async () => ({ status: 200, body: await pricing.alerts() }),
});

export const overheadsRouter = s.router(overheadsContract, {
  year: async ({ query }) => ({ status: 200, body: await overheads.year(query.year) }),
  saveMonth: async ({ req, params, body }) => ({
    status: 200,
    body: await overheads.saveMonth(currentUser(req).id, params.year, params.month, body.lines),
  }),
});
