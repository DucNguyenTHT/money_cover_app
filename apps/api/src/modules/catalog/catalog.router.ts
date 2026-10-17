import { initServer } from '@ts-rest/express';
import { catalogContract } from '../../contracts/catalog.contract';
import { currentUser } from '../../core/auth';
import * as ingredients from './ingredients.service';

const s = initServer();

export const catalogRouter = s.router(catalogContract, {
  listIngredients: async ({ query }) => ({
    status: 200,
    body: await ingredients.list(query.q, query.active === undefined ? undefined : query.active === 'true'),
  }),
  createIngredient: async ({ req, body }) => ({
    status: 201,
    body: await ingredients.create(currentUser(req).id, body),
  }),
  updateIngredient: async ({ req, params, body }) => ({
    status: 200,
    body: await ingredients.update(currentUser(req).id, params.id, body),
  }),
});
