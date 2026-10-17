import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/core/db';
import { verifyApproverPin } from '../../src/modules/auth/auth.service';
import { clientFor, makeUser, resetDb, startServer, stopServer } from '../helpers/harness';

beforeAll(startServer);
afterAll(stopServer);
beforeEach(resetDb);

describe('auth & roles', () => {
  it('rejects requests without a token and non-admin access to admin routes', async () => {
    expect((await clientFor().users.list()).status).toBe(401);
    const staff = await makeUser({ username: 'thungan', role: 'STAFF' });
    expect((await staff.client.users.list()).status).toBe(403);
    expect((await staff.client.settings.get()).status).toBe(200);
  });

  it('first ADMIN login must set a PIN; weak PINs and wrong passwords are refused', async () => {
    const { client } = await makeUser({ username: 'quanly', role: 'ADMIN' });
    expect((await client.auth.me()).body).toMatchObject({ hasPin: false });
    expect((await client.auth.setPin({ body: { currentPassword: 'matkhau123', pin: '1234' } })).status).toBe(
      400,
    );
    expect(
      (await client.auth.setPin({ body: { currentPassword: 'sai-mat-khau', pin: '2580' } })).status,
    ).toBe(403);
    const ok = await client.auth.setPin({ body: { currentPassword: 'matkhau123', pin: '2580' } });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ hasPin: true });
  });
});

describe('users', () => {
  it('keeps at least one active ADMIN and forbids self-lockout', async () => {
    const { user, client } = await makeUser({ username: 'quanly', role: 'ADMIN' });
    const res = await client.users.update({
      params: { id: user.id },
      body: { fullName: 'Q', role: 'STAFF', station: null, active: true },
    });
    expect(res.status).toBe(400);

    const other = await makeUser({ username: 'quanly2', role: 'ADMIN' });
    const selfLock = await client.users.update({
      params: { id: user.id },
      body: { fullName: 'Q', role: 'ADMIN', station: null, active: false },
    });
    expect(selfLock.status).toBe(400);
    const lockOther = await client.users.update({
      params: { id: other.user.id },
      body: { fullName: 'Q2', role: 'ADMIN', station: null, active: false },
    });
    expect(lockOther.status).toBe(200);
  });

  it('kitchen accounts need a station; duplicate usernames are refused', async () => {
    const { client } = await makeUser({ username: 'quanly', role: 'ADMIN' });
    const base = { password: '12345678', fullName: 'Bếp 1', role: 'KITCHEN' as const, active: true };
    expect((await client.users.create({ body: { ...base, username: 'bep1', station: null } })).status).toBe(
      400,
    );
    expect((await client.users.create({ body: { ...base, username: 'bep1', station: 'BAR' } })).status).toBe(
      201,
    );
    expect((await client.users.create({ body: { ...base, username: 'bep1', station: 'BAR' } })).status).toBe(
      409,
    );
  });

  it('reset PIN invalidates it and is written to the audit log', async () => {
    const admin = await makeUser({ username: 'quanly', role: 'ADMIN' });
    const other = await makeUser({ username: 'quanly2', role: 'ADMIN', pin: '2580' });
    const res = await admin.client.users.resetPin({
      params: { id: other.user.id },
      body: { reason: 'quên mã PIN' },
    });
    expect(res.body).toMatchObject({ hasPin: false });
    const log = await prisma.auditLog.findFirst({ where: { action: 'RESET_PIN' } });
    expect(log).toMatchObject({
      entityId: String(other.user.id),
      reason: 'quên mã PIN',
      userId: admin.user.id,
    });
    expect((await admin.client.users.approvers()).body).toEqual([]);
  });
});

describe('approval PIN', () => {
  it('locks the PIN for 5 minutes after 5 wrong attempts', async () => {
    const { user } = await makeUser({ username: 'quanly', role: 'ADMIN', pin: '2580' });
    expect(await verifyApproverPin(prisma, user.id, '2580')).toBe(user.id);
    for (let i = 0; i < 5; i++) {
      await expect(verifyApproverPin(prisma, user.id, '0000')).rejects.toMatchObject({ status: 403 });
    }
    // Even the right PIN is refused while locked.
    await expect(verifyApproverPin(prisma, user.id, '2580')).rejects.toMatchObject({ status: 423 });
    await prisma.user.update({
      where: { id: user.id },
      data: { pinLockedUntil: new Date(Date.now() - 1000) },
    });
    expect(await verifyApproverPin(prisma, user.id, '2580')).toBe(user.id);
  });
});

describe('settings & catalog', () => {
  it('validates and saves settings with an audit row', async () => {
    const { client } = await makeUser({ username: 'quanly', role: 'ADMIN' });
    expect((await client.settings.update({ body: { settings: { vat_pct: 50 } } })).status).toBe(400);
    const res = await client.settings.update({
      body: {
        branch: { name: 'Phở Bò', address: '1 Lê Lợi', phone: '0900' },
        settings: { vat_pct: 8, business_day_start: '04:30' },
      },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      branch: { name: 'Phở Bò' },
      settings: { vat_pct: 8, business_day_start: '04:30' },
    });
    expect(await prisma.auditLog.count({ where: { entity: 'settings' } })).toBe(1);
  });

  it('creates ingredients with exact decimal factors and rejects duplicate codes', async () => {
    const { client } = await makeUser({ username: 'quanly', role: 'ADMIN' });
    const body = {
      code: 'NL01',
      name: 'Thịt bò',
      kind: 'INGREDIENT' as const,
      unit: 'kg',
      recipeUnit: 'g',
      recipeFactor: '1000',
      purchaseUnit: null,
      purchaseFactor: '1',
      category: 'Thịt',
      active: true,
    };
    const created = await client.catalog.createIngredient({ body });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ recipeFactor: '1000' });
    const dup = await client.catalog.createIngredient({ body });
    expect(dup.status).toBe(409);
    expect(dup.body).toMatchObject({ error: { message: 'Mã đã tồn tại' } });
  });
});
