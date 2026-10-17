import { PrismaClient, type Prisma } from '@prisma/client';

export const prisma = new PrismaClient();

/** A Prisma client usable both inside and outside a transaction. */
export type Db = PrismaClient | Prisma.TransactionClient;
export type Tx = Prisma.TransactionClient;

/** Run `fn` in one interactive transaction. Services receive `tx` so several of them can share it. */
export const inTx = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> =>
  prisma.$transaction(fn, { timeout: 20_000, maxWait: 10_000 });
