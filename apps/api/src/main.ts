import { createServer } from 'node:http';
import { env } from './config/env';
import { createApp } from './app';
import { attachRealtime } from './core/realtime';
import { logger } from './core/logger';
import { prisma } from './core/db';

const server = createServer(createApp());
attachRealtime(server);

server.listen(env.PORT, () => logger.info(`API chạy tại http://localhost:${env.PORT} (tài liệu: /api/docs)`));

const shutdown = async () => {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
