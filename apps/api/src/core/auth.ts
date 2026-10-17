import type { IncomingHttpHeaders } from 'node:http';
import type { NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { User } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from './db';
import { AppError, forbidden, unauthorized } from './errors';
import type { RouteMeta } from '../contracts/common';
import type { Role } from '../domain/enums';

export interface AuthUser {
  id: number;
  role: Role;
  station: User['station'];
  fullName: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const TOKEN_TTL = '12h';

export const signToken = (u: Pick<User, 'id' | 'role'>) =>
  jwt.sign({ sub: String(u.id), role: u.role }, env.JWT_SECRET, { expiresIn: TOKEN_TTL });

/** Resolve a bearer token to an active user (also used by Socket.IO). */
export async function userFromToken(token: string | undefined): Promise<AuthUser> {
  if (!token) throw unauthorized();
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
  } catch {
    throw unauthorized('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại');
  }
  const user = await prisma.user.findUnique({ where: { id: Number(payload.sub) } });
  if (!user || !user.active) throw unauthorized('Tài khoản không còn hoạt động');
  return { id: user.id, role: user.role, station: user.station, fullName: user.fullName };
}

/** The bits of a request the auth code needs (works for both Express and ts-rest request types). */
type AuthReq = { headers: IncomingHttpHeaders; user?: AuthUser; tsRestRoute?: object };

const bearer = (req: AuthReq) => {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : undefined;
};

/**
 * ts-rest global middleware: enforces each route's `metadata` ({ public } / { roles }).
 * Routes without metadata require any signed-in user.
 */
export function authMiddleware(req: AuthReq, _res: unknown, next: NextFunction) {
  const meta = ((req.tsRestRoute as { metadata?: RouteMeta } | undefined)?.metadata ?? {}) as RouteMeta;
  if (meta.public) return next();
  userFromToken(bearer(req))
    .then((user) => {
      req.user = user;
      if (meta.roles && !meta.roles.includes(user.role)) throw forbidden();
      next();
    })
    .catch((e: unknown) => next(e instanceof AppError ? e : unauthorized()));
}

/** The signed-in user inside a handler (auth middleware guarantees it for non-public routes). */
export function currentUser(req: { user?: AuthUser }): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
