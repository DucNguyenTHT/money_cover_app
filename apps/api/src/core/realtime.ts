import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { env } from '../config/env';
import { userFromToken } from './auth';
import { logger } from './logger';
import {
  socketRooms,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '../contracts/socket-events';

type Io = Server<ClientToServerEvents, ServerToClientEvents>;
let io: Io | null = null;

export function attachRealtime(server: HttpServer): Io {
  io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
    cors: { origin: env.CORS_ORIGIN.split(',') },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    userFromToken(token)
      .then((user) => {
        socket.data.user = user;
        next();
      })
      .catch(() => next(new Error('UNAUTHORIZED')));
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as Awaited<ReturnType<typeof userFromToken>>;
    if (user.role !== 'KITCHEN') socket.join(socketRooms.pos);
    if (user.role === 'ADMIN') socket.join(socketRooms.admin);
    if (user.role === 'KITCHEN' && user.station) socket.join(socketRooms.kitchen(user.station));
    socket.on('kitchen:join', (station) => {
      // Kitchen accounts are pinned to their own station; staff/admin may watch any.
      if (user.role === 'KITCHEN' && user.station !== station) return;
      socket.join(socketRooms.kitchen(station));
    });
  });

  logger.info('Socket.IO ready');
  return io;
}

/** Emit helper usable from services; a no-op in tests where no server is attached. */
export function emit<E extends keyof ServerToClientEvents>(
  room: string,
  event: E,
  ...args: Parameters<ServerToClientEvents[E]>
) {
  io?.to(room).emit(event, ...args);
}
