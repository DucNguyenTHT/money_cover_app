import { initServer } from '@ts-rest/express';
import { promotionsContract } from '../../contracts/promotions.contract';
import { currentUser } from '../../core/auth';
import * as promotions from './promotions.service';
import { refreshOpenOrders } from '../orders/orders.service';

const s = initServer();

/** Saved promotions apply to the open orders right away. */
const andRefresh = async <T>(work: Promise<T>) => {
  const r = await work;
  await refreshOpenOrders();
  return r;
};

export const promotionsRouter = s.router(promotionsContract, {
  list: async () => ({ status: 200, body: await promotions.list() }),
  create: async ({ req, body }) => ({
    status: 201,
    body: await andRefresh(promotions.create(currentUser(req), body)),
  }),
  update: async ({ req, params, body }) => ({
    status: 200,
    body: await andRefresh(promotions.update(currentUser(req), params.id, body)),
  }),
  remove: async ({ req, params }) => {
    await andRefresh(promotions.remove(currentUser(req), params.id));
    return { status: 200, body: { ok: true as const } };
  },
});
