import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { serverUrl, startServer, stopServer } from '../helpers/harness';

beforeAll(startServer);
afterAll(stopServer);

describe('architecture page', () => {
  it('lists every table and contract module, as plain HTML', async () => {
    const res = await fetch(`${serverUrl()}/api/docs/architecture`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    for (const m of Prisma.dmmf.datamodel.models) expect(html).toContain(`id="t-${m.dbName ?? m.name}"`);
    expect(html).toContain('/api/documents/:id/files');
    expect(html).not.toMatch(/<(img|svg|canvas|script)\b/);
  });
});
