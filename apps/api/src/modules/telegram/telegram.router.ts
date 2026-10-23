import { initServer } from '@ts-rest/express';
import { telegramContract } from '../../contracts/telegram.contract';
import { currentUser } from '../../core/auth';
import * as telegram from './telegram.service';

const s = initServer();

export const telegramRouter = s.router(telegramContract, {
  status: async () => ({ status: 200, body: await telegram.status() }),
  saveToken: async ({ req, body }) => ({
    status: 200,
    body: await telegram.saveToken(currentUser(req).id, body.botToken),
  }),
  chats: async () => ({ status: 200, body: await telegram.chats() }),
  setChat: async ({ req, body }) => ({
    status: 200,
    body: await telegram.setChat(currentUser(req).id, body.chatId, body.title),
  }),
  clear: async ({ req }) => ({ status: 200, body: await telegram.clear(currentUser(req).id) }),
  restoreStatus: async () => ({ status: 200, body: await telegram.restoreStatus() }),
  restore: async ({ req }) => ({ status: 200, body: await telegram.restoreDocuments(currentUser(req).id) }),
});
