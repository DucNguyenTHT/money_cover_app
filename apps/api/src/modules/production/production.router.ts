import { initServer } from '@ts-rest/express';
import { productionContract } from '../../contracts/production.contract';
import { currentUser } from '../../core/auth';
import { redactFor } from '../../core/redact';
import * as production from './production.service';

const s = initServer();

export const productionRouter = s.router(productionContract, {
  semis: async ({ req }) => ({
    status: 200,
    body: redactFor(currentUser(req).role, await production.semis()),
  }),
  recipes: async ({ params }) => ({ status: 200, body: await production.recipes(params.id) }),
  saveRecipe: async ({ req, params, body }) => ({
    status: 200,
    body: await production.saveRecipe(currentUser(req), params.id, body),
  }),
  list: async ({ req, query }) => ({
    status: 200,
    body: redactFor(currentUser(req).role, await production.list(query.month)),
  }),
  plan: async ({ req, body }) => ({
    status: 200,
    body: redactFor(currentUser(req).role, await production.plan(body)),
  }),
  create: async ({ req, body }) => {
    const u = currentUser(req);
    return { status: 201, body: redactFor(u.role, await production.create(u, body)) };
  },
  remove: async ({ req, params, body }) => ({
    status: 200,
    body: await production.remove(currentUser(req), params.id, body.reason),
  }),
});
