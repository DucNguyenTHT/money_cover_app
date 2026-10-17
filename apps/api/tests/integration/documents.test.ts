import { existsSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/core/db';
import { storedPath } from '../../src/core/storage';
import { clientFor, makeUser, resetDb, serverUrl, startServer, stopServer } from '../helpers/harness';
import { branchId, makeIngredient } from '../helpers/factories';

beforeAll(startServer);
afterAll(stopServer);
beforeEach(resetDb);

type Client = ReturnType<typeof clientFor>;

const jpeg = (seed: string) =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`JFIF ${seed} `.repeat(20))]).toString(
    'base64',
  );

const newDoc = (client: Client, date: string, over: Record<string, unknown> = {}) =>
  client.documents.create({
    body: {
      kind: 'PURCHASE',
      date,
      number: null,
      partner: 'Chợ Bình Điền',
      amount: '250000',
      note: null,
      receiptId: null,
      ...over,
    },
  });

const upload = (
  client: Client,
  id: number,
  data: string,
  name = 'hoa-don.jpg',
  thumb: string | null = null,
) => client.documents.addFile({ params: { id }, body: { name, dataBase64: data, thumbBase64: thumb } });

describe('documents (chứng từ)', () => {
  it('staff files an invoice with photos; list filters by month and by year', async () => {
    const { client } = await makeUser({ username: 'thungan', role: 'STAFF' });
    const oct = await newDoc(client, '2026-10-05');
    expect(oct.status).toBe(201);
    const id = (oct.body as { id: number }).id;
    await newDoc(client, '2026-09-20', { kind: 'SALE', amount: '100000', partner: 'Công ty ABC' });

    const f = await upload(client, id, jpeg('a'), 'C:\\fakepath\\Hoá đơn.png', jpeg('thumb'));
    expect(f.status).toBe(201);
    expect(f.body).toMatchObject({ name: 'Hoá đơn.jpg', mime: 'image/jpeg', hasThumb: true });

    // File lands on disk under the document's month.
    const row = await prisma.documentFile.findFirstOrThrow();
    expect(row.path).toMatch(/^2026\/10\/[\w-]+\.jpg$/);
    expect(existsSync(storedPath(row.path))).toBe(true);

    const month = await client.documents.list({ query: { period: '2026-10' } });
    expect(month.status).toBe(200);
    expect(month.body).toMatchObject({
      rows: [{ id, fileCount: 1, cover: { hasThumb: true } }],
      totals: [{ kind: 'PURCHASE', count: 1, amount: '250000' }],
      missingFiles: 0,
    });

    const year = await client.documents.list({ query: { period: '2026' } });
    expect((year.body as { rows: unknown[] }).rows).toHaveLength(2);
    expect(year.body).toMatchObject({ missingFiles: 1 });

    const search = await client.documents.list({ query: { period: '2026', q: 'abc' } });
    expect((search.body as { rows: { partner: string }[] }).rows.map((r) => r.partner)).toEqual([
      'Công ty ABC',
    ]);
  });

  it('serves the bytes only to signed-in users', async () => {
    const { client, token } = await makeUser({ username: 'thungan', role: 'STAFF' });
    const id = ((await newDoc(client, '2026-10-05')).body as { id: number }).id;
    const fileId = ((await upload(client, id, jpeg('b'))).body as { id: number }).id;

    const url = `${serverUrl()}/api/document-files/${fileId}`;

    expect((await fetch(url)).status).toBe(401);
    const ok = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/jpeg');
    expect(Buffer.from(await ok.arrayBuffer()).toString('base64')).toBe(jpeg('b'));
  });

  it('rejects files that are not images / PDF / XML, and duplicates', async () => {
    const { client } = await makeUser({ username: 'thungan', role: 'STAFF' });
    const id = ((await newDoc(client, '2026-10-05')).body as { id: number }).id;

    const exe = await upload(
      client,
      id,
      Buffer.from('MZ\x90\x00 not an invoice').toString('base64'),
      'hoadon.jpg',
    );
    expect(exe.status).toBe(400);

    const xml = Buffer.from('<?xml version="1.0" encoding="UTF-8"?><HDon><TTChung/></HDon>').toString(
      'base64',
    );
    expect((await upload(client, id, xml, 'hd.xml')).body).toMatchObject({ mime: 'application/xml' });
    const pdf = Buffer.from('%PDF-1.7\n%âãÏÓ\n').toString('base64');
    expect((await upload(client, id, pdf, 'hd.pdf')).body).toMatchObject({ mime: 'application/pdf' });

    const other = ((await newDoc(client, '2026-10-06')).body as { id: number }).id;
    const dup = await upload(client, other, pdf, 'copy.pdf');
    expect(dup.status).toBe(409);
    expect(dup.body).toMatchObject({ error: { code: 'DUPLICATE_FILE', details: { documentId: id } } });
  });

  it('the uploader fixes their own items for 24 h; after that only ADMIN, with a reason', async () => {
    const staff = await makeUser({ username: 'thungan', role: 'STAFF' });
    const other = await makeUser({ username: 'phucvu', role: 'STAFF' });
    const admin = await makeUser({ username: 'chu', role: 'ADMIN' });
    const id = ((await newDoc(staff.client, '2026-10-05')).body as { id: number }).id;
    const wrong = ((await upload(staff.client, id, jpeg('wrong'))).body as { id: number }).id;

    // Own wrong photo: delete it straight away, no reason needed, then upload the right one.
    expect(
      (await staff.client.documents.removeFile({ params: { id, fileId: wrong }, body: {} })).status,
    ).toBe(200);
    expect((await upload(staff.client, id, jpeg('right'))).status).toBe(201);
    const fix = await staff.client.documents.update({
      params: { id },
      body: {
        kind: 'PURCHASE',
        date: '2026-10-05',
        number: '9',
        partner: 'Chợ',
        amount: '1',
        note: null,
        receiptId: null,
      },
    });
    expect(fix.status).toBe(200);

    // Someone else's document: no.
    expect(
      (await other.client.documents.remove({ params: { id }, body: { reason: 'nhập nhầm' } })).status,
    ).toBe(403);
    // ADMIN on a staff document: needs a reason.
    expect((await admin.client.documents.remove({ params: { id }, body: {} })).status).toBe(400);

    // After 24 h the uploader can no longer change it.
    await prisma.document.update({
      where: { id },
      data: { createdAt: new Date(Date.now() - 25 * 3600_000) },
    });
    expect(
      (await staff.client.documents.remove({ params: { id }, body: { reason: 'nhập nhầm' } })).status,
    ).toBe(403);
  });

  it('deletes are soft and blocked in a locked month', async () => {
    const staff = await makeUser({ username: 'thungan', role: 'STAFF' });
    const admin = await makeUser({ username: 'chu', role: 'ADMIN' });
    const id = ((await newDoc(staff.client, '2026-09-05')).body as { id: number }).id;
    const fileId = ((await upload(staff.client, id, jpeg('c'))).body as { id: number }).id;

    await prisma.periodLock.create({
      data: { branchId: await branchId(), year: 2026, month: 9, lockedById: admin.user.id },
    });
    const locked = await admin.client.documents.removeFile({
      params: { id, fileId },
      body: { reason: 'ảnh mờ' },
    });
    expect(locked.status).toBe(409);
    // Attaching a forgotten photo to a locked month is still allowed (archive only).
    expect((await upload(staff.client, id, jpeg('late'))).status).toBe(201);

    await prisma.periodLock.deleteMany();
    const del = await admin.client.documents.remove({ params: { id }, body: { reason: 'nhập nhầm' } });
    expect(del.status).toBe(200);
    expect((await admin.client.documents.get({ params: { id } })).status).toBe(404);
    // Row and files are kept for the record.
    const kept = await prisma.document.findUniqueOrThrow({ where: { id }, include: { files: true } });
    expect(kept.deletedAt).not.toBeNull();
    expect(kept.files.every((f) => existsSync(storedPath(f.path)))).toBe(true);
    const audit = await prisma.auditLog.findMany({ where: { entity: 'document', entityId: String(id) } });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['CREATE', 'ADD_FILE', 'DELETE']));
  });

  it('links to a stock receipt and follows it when the receipt is edited', async () => {
    const { client } = await makeUser({ username: 'chu', role: 'ADMIN' });
    const beef = await makeIngredient({ name: 'Thịt bò' });
    const body = {
      kind: 'PURCHASE' as const,
      date: '2026-10-01',
      supplier: 'Chợ Bình Điền',
      note: null,
      items: [{ ingredientId: beef.id, qty: '2', unitPrice: '250000', unitMode: 'STOCK' as const }],
    };
    const r = (await client.inventory.createReceipt({ body })).body as { id: number };
    const doc = (await newDoc(client, '2026-10-01', { receiptId: r.id })).body as { id: number };

    const list = (await client.inventory.listReceipts({ query: { month: '2026-10' } })).body as {
      documentCount: number;
    }[];
    expect(list[0]!.documentCount).toBe(1);

    const upd = await client.inventory.updateReceipt({
      params: { id: r.id },
      body: { ...body, note: 'sửa', reason: 'sửa ghi chú' },
    });
    const newId = (upd.body as { id: number }).id;
    expect(newId).not.toBe(r.id);
    const byReceipt = await client.documents.list({ query: { receiptId: newId } });
    expect((byReceipt.body as { rows: { id: number }[] }).rows.map((d) => d.id)).toEqual([doc.id]);
  });
});
