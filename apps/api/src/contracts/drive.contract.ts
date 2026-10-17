import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { commonErrors, type RouteMeta } from './common';
import { documentPeriod } from './documents.contract';

const c = initContract();
const admin = { roles: ['ADMIN'] } satisfies RouteMeta;

export const driveStatus = z.object({
  /** GOOGLE_CLIENT_ID / SECRET are set on the server. */
  configured: z.boolean(),
  connected: z.boolean(),
  email: z.string().nullable(),
});
export type DriveStatus = z.infer<typeof driveStatus>;

export const deviceCode = z.object({
  userCode: z.string(),
  verificationUrl: z.string(),
  expiresAt: z.string(),
  /** Seconds to wait between polls. */
  interval: z.number(),
});
export type DeviceCode = z.infer<typeof deviceCode>;

export const driveContract = c.router(
  {
    status: {
      method: 'GET',
      path: '/api/drive',
      metadata: admin,
      responses: { 200: driveStatus, ...commonErrors },
    },
    connect: {
      method: 'POST',
      path: '/api/drive/connect',
      body: z.object({}),
      metadata: admin,
      responses: { 200: deviceCode, ...commonErrors },
    },
    poll: {
      method: 'POST',
      path: '/api/drive/connect/poll',
      body: z.object({}),
      metadata: admin,
      responses: {
        200: z.object({ state: z.enum(['PENDING', 'CONNECTED', 'EXPIRED', 'DENIED']), status: driveStatus }),
        ...commonErrors,
      },
    },
    disconnect: {
      method: 'POST',
      path: '/api/drive/disconnect',
      body: z.object({}),
      metadata: admin,
      responses: { 200: driveStatus, ...commonErrors },
    },
    uploadDocuments: {
      method: 'POST',
      path: '/api/drive/upload-documents',
      body: z.object({ period: documentPeriod }),
      metadata: admin,
      responses: {
        200: z.object({
          fileName: z.string(),
          bytes: z.number(),
          documents: z.number(),
          files: z.number(),
          link: z.string().nullable(),
        }),
        ...commonErrors,
      },
    },
  },
  { strictStatusCodes: true },
);
