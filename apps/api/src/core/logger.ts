import pino from 'pino';

const pretty = process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test';

export const logger = pino({
  level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
  ...(pretty ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } } } : {}),
});
