import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@ketoan/api/contracts';
import { tokenStore } from './api-client';

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
let socket: AppSocket | null = null;
let socketToken: string | null = null;

/** One shared connection per tab, re-created when the signed-in user changes. */
export function getSocket(): AppSocket | null {
  const token = tokenStore.get();
  if (!token) return null;
  if (socket && socketToken === token) return socket;
  socket?.disconnect();
  socketToken = token;
  socket = io({ auth: { token }, transports: ['websocket', 'polling'] });
  return socket;
}

type Handlers = { [E in keyof ServerToClientEvents]?: ServerToClientEvents[E] };

/** Subscribe to server events while the component is mounted. Handlers may change between renders. */
export function useRealtime(handlers: Handlers, join?: Parameters<ClientToServerEvents['kitchen:join']>[0]) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const names = Object.keys(ref.current) as (keyof ServerToClientEvents)[];
    const bound = names.map((name) => {
      const fn = (...args: unknown[]) =>
        (ref.current[name] as ((...a: unknown[]) => void) | undefined)?.(...args);
      s.on(name, fn as never);
      return [name, fn] as const;
    });
    const doJoin = () => join && s.emit('kitchen:join', join);
    doJoin();
    s.on('connect', doJoin);
    return () => {
      for (const [name, fn] of bound) s.off(name, fn as never);
      s.off('connect', doJoin);
    };
    // Re-subscribe only when the set of events or the room changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Object.keys(handlers).join(','), join]);
}

/** Live connection state for the "mất kết nối" banner. */
export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    s.on('connect', up);
    s.on('disconnect', down);
    s.on('connect_error', down);
    return () => {
      s.off('connect', up);
      s.off('disconnect', down);
      s.off('connect_error', down);
    };
  }, []);
  return online;
}
